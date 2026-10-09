import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';
import { notifyModelCostAlerts } from '../mock/model-costs.mjs';

async function call(base, token, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}

test('model cost report attributes main and Judge price snapshots without double counting', async t => {
  const { base, client } = await createPgTestServer(t, undefined, { EXPERIMENT_WORKER_MODE: 'external', MODEL_API_BASE_URL: 'https://example.com/v1', MODEL_API_KEY: 'test-only' });
  const admin = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).json()).token;
  const member = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) })).json()).token;
  const createModel = name => call(base, admin, '/experiment-platform/models', 'POST', { name, displayName: name, apiModel: name, provider: 'legacy', inputUsdPerMillion: 1, outputUsdPerMillion: 1, allowedRoles: ['admin', 'member'] });
  const primary = await createModel('cost-main');
  const judge = await createModel('cost-judge');
  assert.equal(primary.status, 201);
  assert.equal(judge.status, 201);
  assert.equal((await call(base, admin, '/experiment-platform/config', 'PUT', { dailyBudgetUsd: 100, concurrencyLimit: 2, judgeModelId: judge.data.id })).status, 200);
  const definition = await call(base, member, '/experiment-definitions', 'POST', { title: '成本归因', taskId: null, systemPrompt: '', userPrompt: 'hello', promptVersionId: null, variables: {}, variants: [{ modelId: primary.data.id, label: '主模型', parameters: { max_tokens: 50 } }] });
  assert.equal(definition.status, 201);
  const batch = await call(base, member, `/experiment-definitions/${definition.data.id}/run`, 'POST', { variables: {} });
  assert.equal(batch.status, 202);
  const run = (await client.query('SELECT id,batch_id FROM experiment_runs WHERE experiment_id=$1', [definition.data.id])).rows[0];
  await client.query("UPDATE experiment_runs SET cost_usd=1.250000,judge_cost_usd=0.250000,judge_model_id=$2,status='completed',completed_at='2026-10-08T12:00:00Z' WHERE id=$1", [run.id, judge.data.id]);
  await client.query("UPDATE experiment_batches SET kind='regression' WHERE id=$1", [run.batch_id]);
  assert.equal((await call(base, member, '/model-costs?start=2026-10-08&end=2026-10-08')).status, 403);
  const report = await call(base, admin, '/model-costs?start=2026-10-08&end=2026-10-08&dimension=model');
  assert.equal(report.status, 200);
  assert.equal(report.data.totalUsd, '1.250000');
  assert.deepEqual(Object.fromEntries(report.data.breakdown.map(item => [item.key, item.costUsd])), { [primary.data.id]: '1.000000', [judge.data.id]: '0.250000' });
  assert.deepEqual(report.data.trend, [{ day: '2026-10-08', costUsd: '1.250000' }]);
  const filtered = await call(base, admin, `/model-costs?start=2026-10-08&end=2026-10-08&dimension=module&modelId=${judge.data.id}&userId=member&module=evaluations`);
  assert.equal(filtered.data.totalUsd, '0.250000');
  assert.equal(filtered.data.breakdown[0].key, 'evaluations');
  assert.equal((await call(base, admin, '/model-costs?start=2026-02-30&end=2026-10-08')).status, 400);
  const originalBudget = await call(base, admin, '/model-cost-budget');
  assert.equal(originalBudget.status, 200);
  assert.equal((await call(base, member, '/model-cost-budget')).status, 403);
  const savedBudget = await call(base, admin, '/model-cost-budget', 'PUT', { monthlyBudgetUsd: 1, version: originalBudget.data.version });
  assert.equal(savedBudget.status, 200);
  assert.equal(savedBudget.data.version, originalBudget.data.version + 1);
  assert.equal((await call(base, admin, '/model-cost-budget', 'PUT', { monthlyBudgetUsd: 2, version: originalBudget.data.version })).status, 409);
  await client.query("UPDATE experiment_runs SET completed_at=now() WHERE id=$1", [run.id]);
  await notifyModelCostAlerts(client);
  await notifyModelCostAlerts(client);
  const warnings = (await client.query("SELECT entity_id FROM app_notifications WHERE kind='model_cost_budget' ORDER BY entity_id")).rows;
  assert.equal(warnings.length, 3);
  assert.deepEqual(warnings.map(row => row.entity_id.split(':').at(-1)), ['100', '120', '80']);
  await client.query(`INSERT INTO experiment_runs(id,batch_id,experiment_id,variant_id,input_index,status,system_prompt,user_prompt,model_id,api_model,parameters,input_price,output_price,reserved_usd,cost_usd,created_at,completed_at)
    SELECT 'cost-prior',batch_id,experiment_id,variant_id,1,'completed',system_prompt,user_prompt,model_id,api_model,parameters,input_price,output_price,reserved_usd,0.01,now()-interval '1 day',now()-interval '1 day' FROM experiment_runs WHERE id=$1`, [run.id]);
  await notifyModelCostAlerts(client);
  await notifyModelCostAlerts(client);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM app_notifications WHERE kind='model_cost_anomaly'")).rows[0].n, 1);
});
