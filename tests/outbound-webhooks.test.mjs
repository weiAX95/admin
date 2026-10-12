import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createPgTestServer } from './pg-helper.mjs';
import { processOutboundWebhooks, resolveWebhookTarget, signedWebhookHeaders } from '../mock/outbound-webhooks.mjs';
import { runRetentionCleanup } from '../mock/retention.mjs';
import { processModelHealthAlerts } from '../mock/model-health.mjs';
import { notifyModelCostAlerts } from '../mock/model-costs.mjs';

const key = 'ab'.repeat(32);
async function login(base, username, password) {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return (await response.json()).token;
}
async function call(base, token, method, path, body) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function localReceiver(t, status = 200, responseText = null) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ headers: req.headers, raw });
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(responseText ?? (status === 200 ? 'ok' : 'temporary failure'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/hook`, requests, setStatus(value) { status = value; } };
}
function clientPool(client) { return { connect: async () => ({ query: (...args) => client.query(...args), release() {} }), query: (...args) => client.query(...args) }; }

test('webhook configuration is admin-only, masked, versioned and rejects private targets by default', async t => {
  const { base, client } = await createPgTestServer(t, undefined, { WEBHOOK_MASTER_KEY: key, WEBHOOK_WORKER_MODE: 'external' });
  const admin = await login(base,'admin','admin123'), member = await login(base,'member','test');
  const data = { event: 'task.completed', url: 'https://1.1.1.1/hook', secret: 'secret-1234567890', headers: { 'X-Project': 'learning' }, enabled: true, confirmExternalFields: true };
  assert.equal((await call(base,member,'GET','/settings/webhooks')).status,403);
  assert.equal((await call(base,admin,'POST','/settings/webhooks',{ ...data, url: 'http://127.0.0.1:9000/hook' })).status,400);
  assert.equal((await call(base,admin,'POST','/settings/webhooks',{ ...data, confirmExternalFields: false })).status,400);
  const created = await call(base,admin,'POST','/settings/webhooks',data);
  assert.equal(created.status,201);
  assert.equal(created.body.secret,undefined);
  assert.equal(created.body.secretMask,'••••7890');
  const db = (await client.query('SELECT secret_cipher,headers_cipher FROM outbound_webhooks WHERE id=$1',[created.body.id])).rows[0];
  assert.equal(Buffer.from(db.secret_cipher).includes(Buffer.from(data.secret)),false);
  assert.equal(Buffer.from(db.headers_cipher).includes(Buffer.from('learning')),false);
  assert.equal((await call(base,admin,'PUT',`/settings/webhooks/${created.body.id}`,{ ...data,version:0 })).status,409);
  const updated = await call(base,admin,'PUT',`/settings/webhooks/${created.body.id}`,{ event: data.event, url: data.url, enabled: false, confirmExternalFields: true, version: 1 });
  assert.equal(updated.status,200);
  assert.equal(updated.body.version,2);
  assert.equal((await call(base,admin,'DELETE',`/settings/webhooks/${created.body.id}`,{ version:2 })).status,200);
  assert.ok((await call(base,admin,'GET','/settings/webhooks')).body.items[0].deletedAt);
  assert.equal((await call(base,admin,'GET',`/settings/webhooks/${created.body.id}/deliveries`)).status,200);
});

test('task completion queues a signed event and delivery records successful response', async t => {
  const receiver = await localReceiver(t);
  const env = { WEBHOOK_MASTER_KEY: key, ALLOW_LOCAL_WEBHOOKS: '1', WEBHOOK_WORKER_MODE: 'external' };
  const { base, client } = await createPgTestServer(t, undefined, env);
  const pool = clientPool(client);
  const admin = await login(base,'admin','admin123');
  const created = await call(base,admin,'POST','/settings/webhooks',{ event:'task.completed',url:receiver.url,secret:'test-shared-secret-123',enabled:true,confirmExternalFields:true });
  assert.equal(created.status,201);
  const task = await call(base,admin,'GET','/tasks/seed-task-1');
  assert.equal((await call(base,admin,'PATCH','/tasks/seed-task-1',{ status:'done',version:task.body.version })).status,200);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM outbound_webhook_events WHERE event_type='task.completed'")).rows[0].n,1);
  assert.equal(await processOutboundWebhooks(pool,env),true);
  assert.equal(receiver.requests.length,1);
  const request = receiver.requests[0];
  const payload = JSON.parse(request.raw);
  assert.equal(payload.event,'task.completed');
  assert.equal(payload.data.taskId,'seed-task-1');
  assert.equal(payload.data.description,'');
  assert.equal(payload.data.priority,'high');
  assert.equal(request.headers['x-webhook-id'],payload.id);
  const expected = crypto.createHmac('sha256','test-shared-secret-123').update(`${request.headers['x-webhook-timestamp']}.${request.raw}`).digest('hex');
  assert.equal(request.headers['x-webhook-signature'],`sha256=${expected}`);
  assert.equal((await client.query('SELECT status,attempt_count FROM outbound_webhook_deliveries')).rows[0].status,'delivered');
  const logs = await call(base,admin,'GET',`/settings/webhooks/${created.body.id}/deliveries`);
  assert.equal(logs.body.items[0].attempts[0].status_code,200);
  assert.equal(logs.body.items[0].attempts[0].response_body,'ok');
});

test('failed delivery retries after 1, 2 and 4 minutes, then stops after four attempts', async t => {
  const receiver = await localReceiver(t,503);
  const env = { WEBHOOK_MASTER_KEY: key, ALLOW_LOCAL_WEBHOOKS: '1', WEBHOOK_WORKER_MODE: 'external' };
  const { base, client } = await createPgTestServer(t, undefined, env);
  const pool = clientPool(client);
  const admin = await login(base,'admin','admin123');
  assert.equal((await call(base,admin,'POST','/settings/webhooks',{ event:'task.completed',url:receiver.url,secret:'test-shared-secret-123',enabled:true,confirmExternalFields:true })).status,201);
  await call(base,admin,'PATCH','/tasks/seed-task-1',{status:'done'});
  for (let attempt=1; attempt<=4; attempt++) {
    assert.equal(await processOutboundWebhooks(pool,env),true);
    const state = (await client.query('SELECT status,attempt_count,next_attempt_at FROM outbound_webhook_deliveries')).rows[0];
    assert.equal(state.attempt_count,attempt);
    assert.equal(state.status,attempt===4?'failed':'pending');
    if (attempt<4) {
      const expected = 2 ** (attempt-1) * 60_000;
      assert.ok(Math.abs(new Date(state.next_attempt_at).getTime()-Date.now()-expected)<10_000);
      await client.query("UPDATE outbound_webhook_deliveries SET next_attempt_at=now() WHERE status='pending'");
    }
  }
  assert.equal(receiver.requests.length,4);
  assert.deepEqual((await client.query('SELECT attempt_number,status_code FROM outbound_webhook_attempts ORDER BY attempt_number')).rows.map(row=>[row.attempt_number,row.status_code]),[[1,503],[2,503],[3,503],[4,503]]);
  assert.equal(await processOutboundWebhooks(pool,env),false);
});

test('note, experiment, evaluation and regression alert changes emit distinct committed events', async t => {
  const env = { WEBHOOK_MASTER_KEY: key, ALLOW_LOCAL_WEBHOOKS: '1', WEBHOOK_WORKER_MODE: 'external' };
  const { base, client } = await createPgTestServer(t, undefined, env);
  const admin = await login(base,'admin','admin123');
  for (const event of ['note.updated','experiment.finished','evaluation.completed','alert.firing']) {
    assert.equal((await call(base,admin,'POST','/settings/webhooks',{ event,url:'http://127.0.0.1:9999/hook',secret:'test-shared-secret-123',enabled:true,confirmExternalFields:true })).status,201);
  }
  await client.query("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES('webhook-note','旧标题','正文','2026-01-01','2026-01-01')");
  await client.query("UPDATE notes SET title='新标题',updated_at='2026-01-02' WHERE id='webhook-note'");
  await client.query("INSERT INTO experiments(id,title) VALUES('webhook-experiment','测试实验')");
  await client.query("INSERT INTO experiment_batches(id,experiment_id,kind,status,inputs) VALUES('webhook-batch-ab','webhook-experiment','ab','queued','[]'),('webhook-batch-eval','webhook-experiment','regression','queued','[]')");
  await client.query("UPDATE experiment_batches SET status='completed',completed_at=now() WHERE id='webhook-batch-ab'");
  await client.query("UPDATE experiment_batches SET status='partial',completed_at=now() WHERE id='webhook-batch-eval'");
  await client.query("INSERT INTO evaluation_alerts(id,batch_id,metric_version_id,affected_count,details) VALUES('webhook-alert','webhook-batch-eval','default-v1',1,'{}')");
  const events = (await client.query('SELECT event_type,payload FROM outbound_webhook_events ORDER BY created_at,id')).rows;
  assert.deepEqual(events.map(row=>row.event_type).sort(),['alert.firing','evaluation.completed','experiment.finished','note.updated']);
  assert.equal(events.find(row=>row.event_type==='note.updated').payload.title,'新标题');
  assert.equal(events.find(row=>row.event_type==='note.updated').payload.content,'正文');
  assert.equal(events.find(row=>row.event_type==='evaluation.completed').payload.status,'partial');
  assert.equal(events.find(row=>row.event_type==='evaluation.completed').payload.runCount,0);
  assert.deepEqual(events.find(row=>row.event_type==='alert.firing').payload.details,{});
  await client.query('BEGIN');
  await client.query("UPDATE notes SET title='未提交',updated_at='2026-01-03' WHERE id='webhook-note'");
  await client.query('ROLLBACK');
  assert.equal((await client.query("SELECT count(*)::int AS n FROM outbound_webhook_events WHERE event_type='note.updated'")).rows[0].n,1);
});

test('target resolution pins public DNS and rejects private rebinding; HMAC uses raw body bytes', async () => {
  await assert.rejects(resolveWebhookTarget('https://example.com/hook',{},async()=>[{ address:'169.254.169.254',family:4 }]));
  await assert.rejects(resolveWebhookTarget('https://example.com/hook',{},async()=>[{ address:'0:0:0:0:0:ffff:7f00:1',family:6 }]));
  const publicTarget = await resolveWebhookTarget('https://example.com/hook',{},async()=>[{ address:'1.1.1.1',family:4 }]);
  assert.equal(publicTarget.address,'1.1.1.1');
  const body = '{"text":"中文"}';
  const headers = signedWebhookHeaders('shared','id-1','note.updated',body,100);
  assert.equal(headers['X-Webhook-Signature'],`sha256=${crypto.createHmac('sha256','shared').update(`100.${body}`).digest('hex')}`);
});

test('retention cascades completed webhook logs but keeps unfinished deliveries', async t => {
  const env = { WEBHOOK_MASTER_KEY: key, ALLOW_LOCAL_WEBHOOKS: '1', WEBHOOK_WORKER_MODE: 'external' };
  const { base, client } = await createPgTestServer(t, undefined, env);
  const admin = await login(base,'admin','admin123');
  const created = await call(base,admin,'POST','/settings/webhooks',{ event:'task.completed',url:'http://127.0.0.1:9999/hook',secret:'test-shared-secret-123',enabled:true,confirmExternalFields:true });
  const id = created.body.id;
  await client.query("INSERT INTO outbound_webhook_events(id,event_type,payload,created_at,fanned_out) VALUES('old-done','task.completed','{}','2020-01-01',true),('old-pending','task.completed','{}','2020-01-01',true)");
  await client.query("INSERT INTO outbound_webhook_deliveries(id,webhook_id,event_id,status) VALUES('delivery-done',$1,'old-done','delivered'),('delivery-pending',$1,'old-pending','pending')",[id]);
  await client.query("INSERT INTO outbound_webhook_attempts(delivery_id,attempt_number,status_code) VALUES('delivery-done',1,200)");
  const result = await runRetentionCleanup(clientPool(client),new Date('2030-01-02T20:00:00Z'),true);
  assert.equal(result.webhookEventsDeleted,1);
  assert.deepEqual((await client.query('SELECT id FROM outbound_webhook_events')).rows.map(row=>row.id),['old-pending']);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM outbound_webhook_attempts')).rows[0].n,0);
});

test('disabling a webhook cancels queued retries while retaining its attempt log', async t => {
  const receiver = await localReceiver(t,503);
  const env = { WEBHOOK_MASTER_KEY: key, ALLOW_LOCAL_WEBHOOKS: '1', WEBHOOK_WORKER_MODE: 'external' };
  const { base, client } = await createPgTestServer(t, undefined, env);
  const admin = await login(base,'admin','admin123');
  const hook = await call(base,admin,'POST','/settings/webhooks',{ event:'task.completed',url:receiver.url,secret:'test-shared-secret-123',enabled:true,confirmExternalFields:true });
  await call(base,admin,'PATCH','/tasks/seed-task-1',{ status:'done' });
  assert.equal(await processOutboundWebhooks(clientPool(client),env),true);
  assert.equal((await client.query('SELECT status FROM outbound_webhook_deliveries')).rows[0].status,'pending');
  const disabled = await call(base,admin,'PUT',`/settings/webhooks/${hook.body.id}`,{ event:'task.completed',url:receiver.url,enabled:false,version:hook.body.version,confirmExternalFields:true });
  assert.equal(disabled.status,200);
  assert.equal((await client.query('SELECT status FROM outbound_webhook_deliveries')).rows[0].status,'cancelled');
  assert.equal((await call(base,admin,'GET',`/settings/webhooks/${hook.body.id}/deliveries`)).body.items[0].attempts.length,1);
  assert.equal(await processOutboundWebhooks(clientPool(client),env),false);
  assert.equal(receiver.requests.length,1);
});

test('receiver echo cannot reveal the shared secret or custom header in delivery logs', async t => {
  const receiver = await localReceiver(t,200,'test-shared-secret-123 / private-header-value');
  const env = { WEBHOOK_MASTER_KEY: key, ALLOW_LOCAL_WEBHOOKS: '1', WEBHOOK_WORKER_MODE: 'external' };
  const { base, client } = await createPgTestServer(t, undefined, env);
  const admin = await login(base,'admin','admin123');
  const hook = await call(base,admin,'POST','/settings/webhooks',{ event:'task.completed',url:receiver.url,secret:'test-shared-secret-123',headers:{'X-Private':'private-header-value'},enabled:true,confirmExternalFields:true });
  await call(base,admin,'PATCH','/tasks/seed-task-1',{status:'done'});
  await processOutboundWebhooks(clientPool(client),env);
  const logs = await call(base,admin,'GET',`/settings/webhooks/${hook.body.id}/deliveries`);
  const body = logs.body.items[0].attempts[0].response_body;
  assert.equal(body.includes('test-shared-secret-123'),false);
  assert.equal(body.includes('private-header-value'),false);
  assert.equal(receiver.requests[0].headers['x-private'],'private-header-value');
});

test('notification alerts deduplicate shared incidents while preserving per-user quota alerts', async t => {
  const env = { WEBHOOK_MASTER_KEY: key, ALLOW_LOCAL_WEBHOOKS: '1', WEBHOOK_WORKER_MODE: 'external' };
  const { base, client } = await createPgTestServer(t, undefined, env);
  const admin = await login(base,'admin','admin123');
  assert.equal((await call(base,admin,'POST','/settings/webhooks',{ event:'alert.firing',url:'http://127.0.0.1:9999/hook',secret:'test-shared-secret-123',enabled:true,confirmExternalFields:true })).status,201);
  const add = (id,user,kind,entity) => client.query('INSERT INTO app_notifications(id,user_id,kind,entity_id,title,body,target_url) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user,kind,entity,'告警标题','告警正文','/model-health']);
  await add('health-admin','admin','model-health','model-a:1');
  await add('health-member','member','model-health','model-a:1');
  await add('quota-admin','admin','model_token_quota','model-a:2026-10-13:80');
  await add('quota-member','member','model_token_quota','model-a:2026-10-13:80');
  await add('regression-admin','admin','evaluation_regression','batch-a');
  const rows = (await client.query("SELECT source_key,payload FROM outbound_webhook_events WHERE event_type='alert.firing' ORDER BY source_key")).rows;
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map(row=>row.source_key),['model-health:model-a:1','model_token_quota:admin:model-a:2026-10-13:80','model_token_quota:member:model-a:2026-10-13:80']);
  assert.equal(rows[0].payload.alertKind,'model-health');
  assert.equal(rows[0].payload.body,'告警正文');
  assert.equal(rows[0].payload.userId,undefined);
  assert.equal(rows[1].payload.userId,'admin');
});

test('model health transitions and cost thresholds generate one outbound alert per incident', async t => {
  const env = { WEBHOOK_MASTER_KEY: key, ALLOW_LOCAL_WEBHOOKS: '1', WEBHOOK_WORKER_MODE: 'external' };
  const { base, client } = await createPgTestServer(t, undefined, env);
  const admin = await login(base,'admin','admin123');
  assert.equal((await call(base,admin,'POST','/settings/webhooks',{ event:'alert.firing',url:'http://127.0.0.1:9999/hook',secret:'test-shared-secret-123',enabled:true,confirmExternalFields:true })).status,201);
  await client.query("INSERT INTO experiment_models(id,display_name,api_model,input_usd_per_million,output_usd_per_million,name) VALUES('webhook-model','Webhook model','webhook-api',0,0,'webhook-model')");
  await client.query("INSERT INTO model_call_audit(request_id,run_id,phase,attempt,model_id,api_model,module,provider,prompt_preview,latency_ms,status_code,succeeded) VALUES($1,'health-run','main',1,'webhook-model','webhook-api','experiments','legacy','',100,500,false)",[crypto.randomUUID()]);
  await processModelHealthAlerts(clientPool(client));
  await processModelHealthAlerts(clientPool(client));
  assert.equal((await client.query("SELECT count(*)::int AS n FROM outbound_webhook_events WHERE source_key LIKE 'model-health:%'")).rows[0].n,1);
  await client.query("UPDATE model_call_audit SET status_code=200,succeeded=true WHERE model_id='webhook-model'");
  await processModelHealthAlerts(clientPool(client));
  await client.query("UPDATE model_call_audit SET status_code=500,succeeded=false WHERE model_id='webhook-model'");
  await processModelHealthAlerts(clientPool(client));
  assert.equal((await client.query("SELECT count(*)::int AS n FROM outbound_webhook_events WHERE source_key LIKE 'model-health:%'")).rows[0].n,2);

  await client.query("UPDATE model_cost_settings SET monthly_budget_usd=1 WHERE id=1");
  await client.query("INSERT INTO model_cost_ledger(run_id,part,model_id,module,amount_usd,charged_at) VALUES('webhook-cost-today','main','webhook-model','experiments',1.2,now())");
  await notifyModelCostAlerts(client);
  await notifyModelCostAlerts(client);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM outbound_webhook_events WHERE source_key LIKE 'model_cost_budget:%'")).rows[0].n,3);
  await client.query("INSERT INTO model_cost_ledger(run_id,part,model_id,module,amount_usd,charged_at) VALUES('webhook-cost-prior','main','webhook-model','experiments',0.01,now()-interval '1 day')");
  await notifyModelCostAlerts(client);
  await notifyModelCostAlerts(client);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM outbound_webhook_events WHERE source_key LIKE 'model_cost_anomaly:%'")).rows[0].n,1);
});
