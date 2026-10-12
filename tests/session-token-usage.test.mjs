import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';

test('reported assistant token usage is persisted once and summarized without estimating missing data', async t => {
  const server = await createPgTestServer(t);
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${server.base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const login = await fetch(`${server.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const empty = await request('/sessions/token-stats');
  assert.equal(empty.data.hasData, false);
  assert.equal(empty.data.totalTokens, null);
  assert.equal(empty.data.averagePerSession, null);

  const at = new Date().toISOString();
  const initial = await request('/sessions/ingest', 'POST', { id: 'usage-session', userId: 'chat-user', messages: [
    { id: 'question', role: 'user', content: '问题', at },
    { id: 'answer', role: 'assistant', content: '答案', at },
  ] });
  assert.equal(initial.status, 201);
  assert.equal((await request('/sessions')).data.items.find(item => item.id === 'usage-session').totalTokens, null);
  const withUsage = { ...initial.data.messages[1], usage: { promptTokens: 17, completionTokens: 3, model: 'model-A' } };
  const late = await request('/sessions/ingest', 'POST', { id: 'usage-session', messages: [withUsage] });
  assert.equal(late.status, 200);
  assert.deepEqual((await request('/sessions/usage-session')).data.messages[1].usage, withUsage.usage);
  assert.equal((await request('/sessions/ingest', 'POST', { id: 'usage-session', messages: [withUsage] })).status, 200);
  assert.equal((await request('/sessions/ingest', 'POST', { id: 'usage-session', messages: [{ ...withUsage, usage: { ...withUsage.usage, promptTokens: 18 } }] })).status, 409);
  assert.equal((await request('/sessions/ingest', 'POST', { id: 'usage-session', messages: [{ ...initial.data.messages[0], usage: withUsage.usage }] })).status, 422);
  assert.equal((await request('/sessions/ingest', 'POST', { id: 'usage-session', messages: [{ ...withUsage, usage: { promptTokens: -1, completionTokens: 3 } }] })).status, 422);

  const old = await request('/sessions/ingest', 'POST', { id: 'old-usage', userId: 'chat-user', messages: [
    { id: 'old-question', role: 'user', content: '旧问题', at: '2020-01-01T00:00:00.000Z' },
    { id: 'old-answer', role: 'assistant', content: '旧答案', at: '2020-01-01T00:00:01.000Z', usage: { promptTokens: 5, completionTokens: 5, model: 'model-B' } },
  ] });
  assert.equal(old.status, 201);
  const list = await request('/sessions');
  assert.equal(list.data.items.find(item => item.id === 'usage-session').totalTokens, 20);
  assert.equal(list.data.items.find(item => item.id === 'old-usage').totalTokens, 10);
  const stats = await request('/sessions/token-stats');
  assert.equal(stats.data.totalTokens, 30);
  assert.equal(stats.data.monthTokens, 20);
  assert.equal(stats.data.averagePerSession, 15);
  assert.equal(stats.data.reportedSessions, 2);
  assert.equal(stats.data.topSessions[0].id, 'usage-session');
  assert.equal(stats.data.daily.reduce((sum, day) => sum + day.totalTokens, 0), 30);
  const exportedResponse = await fetch(`${server.base}/sessions/export`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['usage-session'], format: 'json' }) });
  assert.equal(exportedResponse.status, 200);
  const exported = await exportedResponse.json();
  assert.deepEqual(exported.sessions[0].messages[1].usage, withUsage.usage);
  assert.equal((await server.client.query("SELECT prompt_tokens,completion_tokens,usage_model FROM session_messages WHERE session_id='usage-session' AND id='answer'")).rows[0].prompt_tokens, 17);
});
