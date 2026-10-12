import test from 'node:test';
import assert from 'node:assert/strict';
import { basicFixture, createPgTestServer } from './pg-helper.mjs';

test('only the ingesting account or an admin may append to a session', async t => {
  const fixture = basicFixture();
  fixture.sessions.push({ id: 'legacy-session', userId: 'chat-user', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] });
  const server = await createPgTestServer(t, fixture);
  const request = async (path, method = 'GET', token = '', body) => {
    const response = await fetch(`${server.base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const login = async (username, password) => (await request('/auth/login', 'POST', '', { username, password })).data.token;
  const [admin, member, learner] = await Promise.all([login('admin', 'admin123'), login('member', 'test'), login('learner', 'learn123')]);
  const created = await request('/sessions/ingest', 'POST', member, { id: 'owned-session', userId: 'chat-user', messages: [{ id: 'm1', role: 'user', content: 'first' }] });
  assert.equal(created.status, 201);
  assert.equal((await server.client.query("SELECT ingested_by FROM sessions WHERE id='owned-session'")).rows[0].ingested_by, 'member');

  const append = { id: 'owned-session', messages: [{ id: 'm2', role: 'assistant', content: 'second', usage: { promptTokens: 2, completionTokens: 3 } }] };
  assert.equal((await request('/sessions/ingest', 'POST', '', append)).status, 401);
  assert.equal((await request('/sessions/ingest', 'POST', learner, append)).status, 403);
  assert.equal((await request('/sessions/owned-session', 'GET', learner)).status, 404);
  assert.equal((await request('/sessions', 'GET', learner)).data.items.some(item => item.id === 'owned-session'), false);
  assert.equal((await request('/sessions/owned-session', 'GET', admin)).status, 200);
  assert.equal((await request('/sessions/legacy-session', 'GET', learner)).status, 404);
  assert.equal((await request('/sessions/search?query=first', 'GET', learner)).data.items.length, 0);
  assert.equal((await request('/sessions/search?query=first', 'GET', member)).data.items.length, 1);
  assert.equal((await request('/sessions/export', 'POST', learner, { ids: ['owned-session'], format: 'json' })).status, 404);
  assert.equal((await request('/sessions/owned-session/related', 'GET', learner)).status, 404);
  assert.equal((await request('/sessions/learning-path?userId=chat-user', 'GET', learner)).data.sessions.length, 0);
  assert.equal((await request('/sessions/learning-path?userId=chat-user', 'GET', member)).data.sessions.length, 1);
  assert.equal((await request('/notes', 'POST', learner, { title: '猜测来源', sourceSessionId: 'owned-session' })).status, 404);
  const sourcedNote = await request('/notes', 'POST', member, { title: '本人会话摘录', sourceSessionId: 'owned-session' });
  assert.equal(sourcedNote.status, 201);
  assert.equal((await request(`/notes/${sourcedNote.data.id}`, 'GET', learner)).data.sourceSessionId, null);
  assert.equal((await request(`/notes/${sourcedNote.data.id}`, 'GET', admin)).data.sourceSessionId, 'owned-session');
  assert.equal((await request('/sessions/owned-session', 'GET', member)).data.messages.length, 1);
  assert.equal((await request('/sessions/ingest', 'POST', member, append)).status, 200);
  assert.equal((await request('/sessions/owned-session/messages/m2/annotation', 'POST', learner, { rating: 5, tags: [] })).status, 404);
  assert.equal((await request('/sessions/owned-session/messages/m2/annotation', 'POST', member, { rating: 5, tags: [] })).status, 200);
  assert.equal((await request('/sessions/token-stats', 'GET', learner)).data.totalTokens, null);
  assert.equal((await request('/sessions/token-stats', 'GET', member)).data.totalTokens, 5);
  assert.equal((await request('/sessions/cost-stats', 'GET', learner)).data.unpricedMessages, 0);
  assert.equal((await request('/sessions/cost-stats', 'GET', member)).data.unpricedMessages, 1);
  assert.equal((await request('/sessions/ingest', 'POST', admin, { id: 'owned-session', messages: [{ id: 'm3', role: 'user', content: 'admin append' }] })).status, 200);
  assert.equal((await request('/sessions/owned-session', 'GET', member)).data.messages.length, 3);

  assert.equal((await request('/sessions/ingest', 'POST', member, { id: 'legacy-session', messages: [] })).status, 403);
  assert.equal((await request('/sessions/ingest', 'POST', admin, { id: 'legacy-session', messages: [{ id: 'old-1', role: 'user', content: 'legacy append' }] })).status, 200);
  assert.equal((await server.client.query("SELECT ingested_by FROM sessions WHERE id='legacy-session'")).rows[0].ingested_by, null);
  assert.equal((await request('/users/member', 'DELETE', admin)).status, 200);
  assert.equal((await server.client.query("SELECT ingested_by FROM sessions WHERE id='owned-session'")).rows[0].ingested_by, null);
  assert.equal((await request('/sessions/ingest', 'POST', learner, { id: 'owned-session', messages: [] })).status, 403);
  assert.equal((await request('/sessions/ingest', 'POST', admin, { id: 'owned-session', messages: [{ id: 'm4', role: 'user', content: 'retained after account removal' }] })).status, 200);
});
