import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';
import { processDueModelRetirements } from '../mock/model-retirement.mjs';

async function login(base, username, password) { return (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()).token; }
async function call(base, token, path, method = 'GET', body) { const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }

test('deprecation notifies owners, stops new references and retires after seven days', async t => {
  const { base, client } = await createPgTestServer(t, undefined, { EXPERIMENT_WORKER_MODE: 'external', MODEL_API_BASE_URL: 'https://example.com/v1', MODEL_API_KEY: 'test-only' });
  const worker = { connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };
  const admin = await login(base, 'admin', 'admin123'), member = await login(base, 'member', 'test');
  const payload = { name: 'retire-primary', displayName: 'Retire Primary', apiModel: 'retire-primary', provider: 'legacy', inputUsdPerMillion: 1, outputUsdPerMillion: 1, allowedRoles: ['admin', 'member'] };
  const primary = await call(base, admin, '/experiment-platform/models', 'POST', payload);
  const judge = await call(base, admin, '/experiment-platform/models', 'POST', { ...payload, name: 'retire-judge', displayName: 'Retire Judge', apiModel: 'retire-judge' });
  assert.equal(primary.status, 201);
  assert.equal((await call(base, admin, '/experiment-platform/config', 'PUT', { dailyBudgetUsd: 100, concurrencyLimit: 2, judgeModelId: judge.data.id })).status, 200);
  const definition = await call(base, member, '/experiment-definitions', 'POST', { title: '退役实验', taskId: null, systemPrompt: '', userPrompt: 'hello', promptVersionId: null, variables: {}, variants: [{ modelId: primary.data.id, label: '主模型', parameters: { max_tokens: 50 } }] });
  assert.equal(definition.status, 201);
  assert.equal((await call(base, member, `/experiment-definitions/${definition.data.id}/run`, 'POST', { variables: {} })).status, 202);
  const deprecated = await call(base, admin, `/experiment-platform/models/${primary.data.id}`, 'PATCH', { ...payload, active: true, status: 'deprecated' });
  assert.equal(deprecated.status, 200);
  const config = (await call(base, admin, '/experiment-platform/config')).data.models.find(item => item.id === primary.data.id);
  assert.ok(config.retireAt);
  assert.ok(Date.parse(config.retireAt) - Date.parse(config.deprecatedAt) >= 7 * 86400000 - 1000);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM app_notifications WHERE user_id='member' AND kind='model_deprecated'")).rows[0].n, 1);
  assert.equal((await call(base, member, `/experiment-definitions/${definition.data.id}/run`, 'POST', { variables: {} })).status, 409);
  await client.query("UPDATE experiment_models SET retire_at=now()-interval '1 second' WHERE id=$1", [primary.data.id]);
  assert.equal(await processDueModelRetirements(worker), 1);
  assert.equal(await processDueModelRetirements(worker), 0);
  assert.equal((await client.query('SELECT status FROM experiment_models WHERE id=$1', [primary.data.id])).rows[0].status, 'retired');
  assert.equal((await client.query("SELECT count(*)::int AS n FROM experiment_runs WHERE model_id=$1 AND status='failed' AND error='模型已退役'", [primary.data.id])).rows[0].n, 1);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM app_notifications WHERE user_id='member' AND kind='model_retired'")).rows[0].n, 1);
  assert.equal((await call(base, admin, `/experiment-platform/models/${primary.data.id}`, 'PATCH', { ...payload, active: true, status: 'active' })).status, 409);
  assert.equal((await call(base, member, `/experiment-platform/models/${judge.data.id}/retire`, 'POST')).status, 403);
  assert.equal((await call(base, admin, `/experiment-platform/models/${judge.data.id}/retire`, 'POST')).status, 200);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM security_audit_logs WHERE action='emergency_retire' AND target_id=$1", [judge.data.id])).rows[0].n, 1);
});
