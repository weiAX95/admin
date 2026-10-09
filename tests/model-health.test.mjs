import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPgTestServer } from './pg-helper.mjs';
import { processModelHealthAlerts } from '../mock/model-health.mjs';

test('model health exposes recent call rates and latency only to admins', async t => {
  const { base, client, url } = await createPgTestServer(t);
  await client.query(`INSERT INTO experiment_models(id,display_name,api_model,input_usd_per_million,output_usd_per_million,name) VALUES('health-model','Health model','health-api',0,0,'health-model')`);
  for (const [latency, status] of [[100,200],[200,200],[300,500]]) {
    await client.query(`INSERT INTO model_call_audit(request_id,run_id,phase,attempt,model_id,api_model,module,provider,prompt_preview,latency_ms,status_code,succeeded) VALUES($1,'health-run','main',1,'health-model','health-api','experiments','legacy','', $2,$3,$4)`, [randomUUID(),latency,status,status === 200]);
  }
  const login = async (username, password) => (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()).token;
  const admin = await login('admin','admin123');
  const member = await login('member','test');
  const read = token => fetch(`${base}/model-health`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await read(member)).status, 403);
  const response = await read(admin);
  assert.equal(response.status, 200);
  const body = await response.json();
  const model = body.items.find(item => item.id === 'health-model');
  assert.equal(model.sampleCount, 3);
  assert.equal(model.qps, 0.01);
  assert.equal(model.p50Ms, 200);
  assert.equal(model.p95Ms, 290);
  assert.equal(model.errorRate5xx, 33.33);
  assert.equal(model.health, 'degraded');
  const pool = new pg.Pool({ connectionString: url });
  await processModelHealthAlerts(pool);
  await processModelHealthAlerts(pool);
  assert.equal(Number((await client.query("SELECT count(*) FROM app_notifications WHERE kind='model-health'")).rows[0].count), 1);
  await client.query("UPDATE model_call_audit SET status_code=200,succeeded=true WHERE model_id='health-model'");
  await processModelHealthAlerts(pool);
  assert.equal((await client.query("SELECT degraded FROM model_health_alert_state WHERE model_id='health-model'")).rows[0].degraded, false);
  await pool.end();
});
