import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';

async function login(base, username, password) { return (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()).token; }
async function call(base, token, path, method = 'GET', body) { const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json(), retryAfter: response.headers.get('Retry-After') }; }

test('model RPM and TPM reject whole batches with 429 and Retry-After', async t => {
  const { base, client } = await createPgTestServer(t, undefined, { EXPERIMENT_WORKER_MODE: 'external', MODEL_API_BASE_URL: 'https://example.com/v1', MODEL_API_KEY: 'test-only' });
  const admin = await login(base, 'admin', 'admin123'), member = await login(base, 'member', 'test');
  const model = await call(base, admin, '/experiment-platform/models', 'POST', { name: 'rate-primary', displayName: 'Rate Primary', apiModel: 'rate-primary', provider: 'legacy', inputUsdPerMillion: 1, outputUsdPerMillion: 1, allowedRoles: ['admin', 'member'] });
  const judge = await call(base, admin, '/experiment-platform/models', 'POST', { name: 'rate-judge', displayName: 'Rate Judge', apiModel: 'rate-judge', provider: 'legacy', inputUsdPerMillion: 1, outputUsdPerMillion: 1, allowedRoles: ['admin', 'member'] });
  assert.equal(model.status, 201);
  assert.equal((await call(base, admin, '/experiment-platform/config', 'PUT', { dailyBudgetUsd: 100, concurrencyLimit: 2, judgeModelId: judge.data.id })).status, 200);
  const definition = await call(base, member, '/experiment-definitions', 'POST', { title: '速率实验', taskId: null, systemPrompt: '', userPrompt: 'hello', promptVersionId: null, variables: {}, variants: [{ modelId: model.data.id, label: '模型', parameters: { max_tokens: 50 } }] });
  assert.equal(definition.status, 201);
  const path = `/experiment-definitions/${definition.data.id}/run`;
  assert.equal((await call(base, member, '/model-rate-limits')).status, 403);
  assert.equal((await call(base, admin, '/model-rate-limits', 'PUT', { modelId: model.data.id, rpm: 1, tpm: 1_000_000 })).status, 200);
  const first = await call(base, member, path, 'POST', { variables: {} });
  assert.equal(first.status, 202);
  const blocked = await call(base, member, path, 'POST', { variables: {} });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.requestedRequests, 1);
  assert.ok(Number(blocked.retryAfter) >= 1 && Number(blocked.retryAfter) <= 60);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM experiment_batches WHERE owner_id='member'")).rows[0].n, 1);
  const status = await call(base, admin, '/model-rate-status');
  assert.equal(status.data.items[0].usedRequests, 1);
  assert.equal(status.data.items[0].remainingRequests, 0);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM app_notifications WHERE kind='model_rate_near_limit'")).rows[0].n, 1);
  assert.equal((await call(base, admin, '/model-rate-limits', 'PUT', { modelId: model.data.id, rpm: 10, tpm: 1 })).status, 200);
  assert.equal((await call(base, member, path, 'POST', { variables: {} })).status, 429);
  assert.equal((await call(base, admin, '/model-rate-limits', 'PUT', { modelId: model.data.id, rpm: 2, tpm: 1_000_000 })).status, 200);
  const concurrent = await Promise.all([0, 1].map(() => call(base, member, path, 'POST', { variables: {} })));
  assert.deepEqual(concurrent.map(item => item.status).sort(), [202, 429]);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM experiment_batches WHERE owner_id='member'")).rows[0].n, 2);
});
