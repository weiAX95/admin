import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createPgTestServer } from './pg-helper.mjs';
import { maskAuditPrompt, enqueueModelCallAudit, flushModelCallAudits } from '../mock/model-call-audit.mjs';
import { completeWithProvider } from '../mock/provider-adapters.mjs';

test('audit prompt masks known private patterns before truncation', () => {
  const preview = maskAuditPrompt([{ role: 'user', content: '联系 13812345678，a@example.com，身份证 110101199003074218，sk-abcdefghijklmnop，api_key=abcdefghi' }]);
  assert.match(preview, /\[手机号\].*\[邮箱\].*\[身份证号\].*\[密钥\].*\[API Key\]/);
  assert.doesNotMatch(preview, /13812345678|a@example.com|110101199003074218|abcdefghijklmnop|abcdefghi/);
  assert.equal(maskAuditPrompt([{ content: '中'.repeat(300) }]).length, 200);
});

test('provider call records one asynchronous sanitized audit for success and HTTP failure', async t => {
  let status = 200;
  const server = http.createServer((_, response) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(status === 200 ? JSON.stringify({ choices: [{ message: { content: '好的' } }], usage: { prompt_tokens: 9, completion_tokens: 3 } }) : '{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const previous = { base: process.env.MODEL_API_BASE_URL, key: process.env.MODEL_API_KEY };
  process.env.MODEL_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.MODEL_API_KEY = 'test-key';
  t.after(() => { if (previous.base === undefined) delete process.env.MODEL_API_BASE_URL; else process.env.MODEL_API_BASE_URL = previous.base; if (previous.key === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previous.key; });
  const recorded = [];
  const client = { query: async (sql, params) => { if (sql.includes('FROM model_connections')) return { rows: [] }; if (sql.includes('INSERT INTO model_call_audit')) { recorded.push(params); return { rowCount: 1 }; } throw new Error('unexpected query'); } };
  const options = { provider: 'legacy', model: 'audit-test', messages: [{ role: 'user', content: '请联系 13812345678' }], audit: { runId: 'run-1', phase: 'main', attempt: 1, userId: 'member', modelId: 'model-1', module: 'experiments' } };
  const value = await completeWithProvider(client, options);
  assert.equal(value.promptTokens, 9);
  await flushModelCallAudits();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0][9], '请联系 [手机号]');
  assert.equal(recorded[0][10], 9);
  assert.equal(recorded[0][13], 200);
  assert.equal(recorded[0][14], true);
  status = 429;
  await assert.rejects(completeWithProvider(client, options), /HTTP 429/);
  await flushModelCallAudits();
  assert.equal(recorded.length, 2);
  assert.equal(recorded[1][13], 429);
  assert.equal(recorded[1][14], false);
  assert.notEqual(recorded[0][0], recorded[1][0]);
});

test('admin audit query filters rows and ordinary accounts cannot read them', async t => {
  const { base, client } = await createPgTestServer(t);
  const login = async (username, password) => (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()).token;
  const admin = await login('admin', 'admin123'), member = await login('member', 'test');
  enqueueModelCallAudit(client, { requestId: randomUUID(), runId: 'deleted-run', phase: 'main', attempt: 1, userId: 'member', modelId: 'deleted-model', apiModel: 'legacy', module: 'evaluations', provider: 'legacy', messages: [{ content: '邮箱 a@example.com' }], promptTokens: 3, completionTokens: 2, latencyMs: 42, statusCode: 200, succeeded: true, errorCode: null });
  await flushModelCallAudits();
  const read = async (token, query) => { const response = await fetch(`${base}/model-call-audit?${query}`, { headers: { Authorization: `Bearer ${token}` } }); return { status: response.status, body: await response.json() }; };
  assert.equal((await read(member, '')).status, 403);
  const result = await read(admin, 'module=evaluations&userId=member');
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 1);
  assert.equal(result.body.items[0].promptPreview, '邮箱 [邮箱]');
  assert.equal((await read(admin, 'module=experiments')).body.total, 0);
  assert.equal((await read(admin, 'start=2026-99-99')).status, 400);
});
