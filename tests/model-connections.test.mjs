import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createPgTestServer } from './pg-helper.mjs';
import { resolveModelConnection } from '../mock/model-connections.mjs';

async function api(base, token, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, value: await response.json() };
}
async function login(base, username, password) {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return (await response.json()).token;
}

test('encrypted model connections mask keys, choose defaults, bind models and test with minimum request', async t => {
  const received = [];
  const upstream = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    received.push({ authorization: req.headers.authorization, tenant: req.headers['x-tenant'], input: JSON.parse(input) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const key = randomBytes(32).toString('hex');
  const { base, client } = await createPgTestServer(t, undefined, { MODEL_CONNECTION_MASTER_KEY: key, ALLOW_LOCAL_MODEL_ENDPOINTS: '1' });
  process.env.MODEL_CONNECTION_MASTER_KEY = key;
  t.after(() => { delete process.env.MODEL_CONNECTION_MASTER_KEY; });
  const admin = await login(base, 'admin', 'admin123');
  const member = await login(base, 'member', 'test');
  const route = '/settings/model-connections';
  assert.equal((await api(base, member, route)).status, 403);
  const secret = 'sk-test-secret-1234';
  const created = await api(base, admin, route, 'POST', { provider: 'legacy', name: '测试项目', apiKey: secret, baseUrl: `http://127.0.0.1:${upstream.address().port}`, headers: { 'x-tenant': 'private-tenant' }, isDefault: true });
  assert.equal(created.status, 201);
  assert.equal(created.value.keyMask, 'sk-t••••1234');
  assert.ok(!JSON.stringify(created.value).includes(secret));
  assert.ok(!JSON.stringify((await api(base, admin, route)).value).includes('private-tenant'));
  const stored = (await client.query('SELECT * FROM model_connections WHERE id=$1', [created.value.id])).rows[0];
  assert.ok(!stored.key_cipher.toString('utf8').includes(secret));
  assert.ok(!stored.headers_cipher.toString('utf8').includes('private-tenant'));
  const resolved = await resolveModelConnection(client, 'legacy');
  assert.equal(resolved.key, secret);
  assert.equal(resolved.headers['x-tenant'], 'private-tenant');
  const model = await api(base, admin, '/experiment-platform/models', 'POST', { displayName: '测试模型', apiModel: 'test-model', provider: 'legacy', connectionId: created.value.id, inputUsdPerMillion: 1, outputUsdPerMillion: 1 });
  assert.equal(model.status, 201);
  const config = (await api(base, admin, '/experiment-platform/config')).value;
  assert.equal(config.models.find(item => item.id === model.value.id).connectionId, created.value.id);
  assert.equal((await api(base, admin, `${route}/${created.value.id}/test`, 'POST', { modelId: model.value.id })).status, 200);
  assert.equal(received.length, 1);
  assert.equal(received[0].authorization, `Bearer ${secret}`);
  assert.equal(received[0].tenant, 'private-tenant');
  assert.equal(received[0].input.max_tokens, 1);
  const stale = await api(base, admin, `${route}/${created.value.id}`, 'PUT', { version: 0, name: '旧版本', active: true });
  assert.equal(stale.status, 409);
  const updated = await api(base, admin, `${route}/${created.value.id}`, 'PUT', { version: created.value.version, name: '新名称', active: true, isDefault: true, baseUrl: `http://127.0.0.1:${upstream.address().port}` });
  assert.equal(updated.status, 200);
  assert.equal(updated.value.name, '新名称');
  assert.ok(!JSON.stringify(updated.value).includes(secret));
  const second = await api(base, admin, route, 'POST', { provider: 'legacy', name: '第二项目', apiKey: 'sk-second-secret-5678', baseUrl: `http://127.0.0.1:${upstream.address().port}`, isDefault: true });
  assert.equal(second.status, 201);
  assert.equal((await client.query('SELECT count(*)::int AS total FROM model_connections WHERE provider=$1 AND is_default=true', ['legacy'])).rows[0].total, 1);
  assert.equal((await resolveModelConnection(client, 'legacy')).key, 'sk-second-secret-5678');
  assert.equal((await resolveModelConnection(client, 'legacy', created.value.id)).key, secret);
  const rotated = await api(base, admin, `${route}/${created.value.id}`, 'PUT', { version: updated.value.version, name: '新名称', active: true, isDefault: false, baseUrl: `http://127.0.0.1:${upstream.address().port}`, apiKey: 'sk-rotated-secret-9999', headers: { 'x-tenant': 'new-private-tenant' } });
  assert.equal(rotated.status, 200);
  assert.equal((await resolveModelConnection(client, 'legacy', created.value.id)).key, 'sk-rotated-secret-9999');
  assert.equal((await resolveModelConnection(client, 'legacy', created.value.id)).headers['x-tenant'], 'new-private-tenant');
  const disabled = await api(base, admin, `${route}/${created.value.id}`, 'PUT', { version: rotated.value.version, name: '新名称', active: false, isDefault: false, baseUrl: `http://127.0.0.1:${upstream.address().port}` });
  assert.equal(disabled.status, 200);
  assert.equal((await api(base, admin, '/experiment-platform/config')).value.models.find(item => item.id === model.value.id).configured, false);
  assert.equal((await api(base, admin, `${route}/${created.value.id}/test`, 'POST', { modelId: model.value.id })).status, 400);
});
