import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPgTestServer } from './pg-helper.mjs';

test('two reviewers remain blind, disputed scores need a third account', async t => {
  const modelServer = http.createServer(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{"score":4,"reason":"ok"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => modelServer.close(resolve)));
  const api = await createPgTestServer(t, undefined, { MODEL_API_BASE_URL: `http://127.0.0.1:${modelServer.address().port}`, MODEL_API_KEY: 'test' });
  const login = async (username, password) => (await (await fetch(`${api.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()).token;
  const tokens = { admin: await login('admin', 'admin123'), member: await login('member', 'test'), learner: await login('learner', 'learn123') };
  const request = async (who, path, method = 'GET', body) => {
    const response = await fetch(`${api.base}${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const model = await request('admin', '/experiment-platform/models', 'POST', { displayName: 'test', apiModel: 'test', inputUsdPerMillion: 1, outputUsdPerMillion: 1 });
  await request('admin', '/experiment-platform/config', 'PUT', { dailyBudgetUsd: 10, concurrencyLimit: 2, judgeModelId: model.data.id });
  const definition = await request('admin', '/experiment-definitions', 'POST', { title: '人工评测源', systemPrompt: '系统', userPrompt: '{{question}}', variables: { question: '测试' }, variants: [{ modelId: model.data.id, label: 'A', parameters: { max_tokens: 50 } }] });
  const dataset = await request('admin', '/experiment-datasets', 'POST', { name: '人工评分', cases: [{ caseKey: 'first', input: '测试', expectedOutput: '回答' }] });
  const batch = await request('admin', `/experiment-definitions/${definition.data.id}/dataset-run`, 'POST', { datasetVersionId: dataset.data.version.id, metricVersionId: 'default-v1', variantIds: [definition.data.variants[0].id] });
  let completed = false;
  for (let i = 0; i < 50; i++) { await new Promise(resolve => setTimeout(resolve, 100)); const state = await request('admin', `/experiment-batches/${batch.data.batchId}`); if (state.data.status === 'completed') { completed = true; break; } }
  assert.ok(completed);
  const task = await request('admin', '/evaluation/reviews', 'POST', { batchId: batch.data.batchId, reviewerIds: ['member', 'learner'], tags: ['准确', '偏题'] });
  assert.equal(task.status, 201, JSON.stringify(task.data));
  const taskId = task.data.id;
  const memberInbox = await request('member', `/evaluation/reviews/${taskId}/inbox`);
  assert.equal(memberInbox.data.items.length, 1);
  const runId = memberInbox.data.items[0].run_id;
  assert.equal((await request('member', `/evaluation/reviews/${taskId}/report`)).status, 403);
  assert.equal((await request('member', `/evaluation/reviews/${taskId}/scores/${runId}`, 'POST', { accuracy: 8, completeness: 8, brevity: 8, safety: 8, tags: ['准确'] })).status, 200);
  assert.equal((await request('member', `/evaluation/reviews/${taskId}/inbox`)).data.items.length, 0);
  assert.equal((await request('learner', `/evaluation/reviews/${taskId}/inbox`)).data.items.length, 1);
  assert.equal((await request('learner', `/evaluation/reviews/${taskId}/scores/${runId}`, 'POST', { accuracy: 5, completeness: 8, brevity: 8, safety: 8, tags: [] })).status, 200);
  const report = await request('admin', `/evaluation/reviews/${taskId}/report`);
  assert.equal(report.data.disputes.length, 1);
  assert.equal(report.data.disputes[0].adjudicated, false);
  assert.equal((await request('admin', `/evaluation/reviews/${taskId}/adjudicator`, 'POST', { userId: 'admin' })).status, 200);
  assert.equal((await request('admin', `/evaluation/reviews/${taskId}/inbox`)).data.items.length, 1);
  assert.equal((await request('admin', `/evaluation/reviews/${taskId}/scores/${runId}`, 'POST', { accuracy: 7, completeness: 8, brevity: 8, safety: 8, tags: [] })).status, 200);
  assert.equal((await request('admin', `/evaluation/reviews/${taskId}/report`)).data.disputes[0].adjudicated, true);
});
