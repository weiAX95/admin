import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPgTestServer } from './pg-helper.mjs';
import { processDueEvaluationSchedules } from '../mock/evaluation-schedules.mjs';
import pg from 'pg';

test('evaluation schedule persists fixed versions and creates each due occurrence once', async t => {
  const modelServer = http.createServer(async (req, res) => {
    for await (const _ of req) {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '正确答案' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => modelServer.close(resolve)));
  const api = await createPgTestServer(t, undefined, { MODEL_API_BASE_URL: `http://127.0.0.1:${modelServer.address().port}`, MODEL_API_KEY: 'test' });
  const pool = new pg.Pool({ connectionString: api.url });
  const login = await fetch(`${api.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`${api.base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const model = (await call('/experiment-platform/models', 'POST', { displayName: 'Test', apiModel: 'test', inputUsdPerMillion: 1, outputUsdPerMillion: 1 })).data;
  await call('/experiment-platform/config', 'PUT', { dailyBudgetUsd: 10, concurrencyLimit: 1, judgeModelId: model.id });
  const experiment = (await call('/experiment-definitions', 'POST', { title: '定时评测', systemPrompt: '系统', userPrompt: '{{question}}', variables: { question: '默认' }, variants: [{ modelId: model.id, label: 'A', parameters: { max_tokens: 10 } }] })).data;
  const dataset = (await call('/experiment-datasets', 'POST', { name: '定时数据集', cases: [{ caseKey: 'case-1', variables: { question: '问题' }, referenceAnswer: '正确答案' }] })).data;
  const schedule = await call('/evaluation/schedules', 'POST', { experimentId: experiment.id, variantId: experiment.variants[0].id, datasetVersionId: dataset.version.id, metricVersionId: 'default-v1', frequency: 'daily', localTime: '09:00' });
  assert.equal(schedule.status, 201, JSON.stringify(schedule.data));
  assert.equal((await call('/evaluation/schedules')).data.items.length, 1);
  const dueAt = new Date(Date.now() - 60_000);
  await api.client.query('UPDATE evaluation_schedules SET next_run_at=$2 WHERE id=$1', [schedule.data.id, dueAt]);
  const previousBase = process.env.MODEL_API_BASE_URL;
  const previousKey = process.env.MODEL_API_KEY;
  process.env.MODEL_API_BASE_URL = `http://127.0.0.1:${modelServer.address().port}`;
  process.env.MODEL_API_KEY = 'test';
  try {
    await processDueEvaluationSchedules(pool);
    await processDueEvaluationSchedules(pool);
  } finally {
    if (previousBase === undefined) delete process.env.MODEL_API_BASE_URL; else process.env.MODEL_API_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previousKey;
  }
  const occurrences = (await api.client.query('SELECT * FROM evaluation_schedule_occurrences WHERE schedule_id=$1', [schedule.data.id])).rows;
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].due_at.toISOString(), dueAt.toISOString());
  assert.ok(occurrences[0].batch_id, JSON.stringify(occurrences[0]));
  const batch = (await api.client.query('SELECT dataset_version_id,metric_version_id FROM experiment_batches WHERE id=$1', [occurrences[0].batch_id])).rows[0];
  assert.equal(batch.dataset_version_id, dataset.version.id);
  assert.equal(batch.metric_version_id, 'default-v1');
  assert.equal((await call(`/evaluation/schedules/${schedule.data.id}`, 'PATCH', { active: false })).status, 200);
  assert.equal((await call('/evaluation/schedules')).data.items[0].active, false);
  assert.equal((await call(`/evaluation/schedules/${schedule.data.id}`, 'PATCH', { active: true })).status, 200);
  assert.equal((await call(`/evaluation/schedules/${schedule.data.id}`, 'DELETE')).status, 200);
  assert.equal((await call('/evaluation/schedules')).data.items.length, 0);
  await pool.end();
});
