import test from 'node:test';
import assert from 'node:assert/strict';
import { basicFixture, createPgTestServer } from './pg-helper.mjs';
import { detectSessionQuality } from '../mock/session-quality.mjs';

test('refusal and reported long outputs are detected without guessing missing token counts', () => {
  assert.deepEqual(detectSessionQuality([
    { id: 'user', role: 'user', content: '我无法理解这个问题' },
    { id: 'a', role: 'assistant', content: '我无法提供这个内容' },
    { id: 'b', role: 'assistant', content: '对不起，当前无法完成', usage: { promptTokens: 1, completionTokens: 2001 } },
    { id: 'c', role: 'assistant', content: '正常回答', usage: { promptTokens: 1, completionTokens: 2000 } },
    { id: 'd', role: 'assistant', content: 'x'.repeat(9000) },
  ]), [
    { messageId: 'a', type: 'rejection' },
    { messageId: 'b', type: 'rejection' },
    { messageId: 'b', type: 'excessive_length' },
  ]);
});

test('session quality flags persist and filter the list after ingest and usage supplement', async t => {
  const server = await createPgTestServer(t);
  const request = async (path, method = 'GET', token = '', body) => {
    const response = await fetch(`${server.base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const admin = (await request('/auth/login', 'POST', '', { username: 'admin', password: 'admin123' })).data.token;
  const created = await request('/sessions/ingest', 'POST', admin, { id: 'quality-1', userId: 'chat', messages: [
    { id: 'q1', role: 'user', content: '问题' },
    { id: 'a1', role: 'assistant', content: '我不能回答' },
    { id: 'a2', role: 'assistant', content: '详细回答' },
  ] });
  assert.equal(created.status, 201);
  assert.deepEqual((await request('/sessions?quality=rejection', 'GET', admin)).data.items.map(item => item.id), ['quality-1']);
  assert.deepEqual((await request('/sessions?quality=excessive_length', 'GET', admin)).data.items, []);
  assert.equal((await request('/sessions?quality=unknown', 'GET', admin)).status, 400);
  const supplemented = await request('/sessions/ingest', 'POST', admin, { id: 'quality-1', messages: [{ id: 'a2', role: 'assistant', content: '详细回答', at: created.data.messages[2].at, usage: { promptTokens: 5, completionTokens: 2001 } }] });
  assert.equal(supplemented.status, 200);
  const rows = (await request('/sessions', 'GET', admin)).data.items;
  assert.deepEqual(rows[0].qualityFlags, ['rejection', 'excessive_length']);
  assert.deepEqual(new Set((await request('/sessions/quality-1', 'GET', admin)).data.qualityFlags), new Set(['rejection', 'excessive_length']));
  assert.deepEqual((await request('/sessions?quality=excessive_length', 'GET', admin)).data.items.map(item => item.id), ['quality-1']);
  assert.equal((await server.client.query("SELECT count(*)::int AS count FROM session_quality_flags WHERE session_id='quality-1'")).rows[0].count, 2);
  await server.client.query("UPDATE session_quality_flags SET detected_at='2020-01-01T00:00:00Z' WHERE session_id='quality-1'");
  assert.equal((await request('/sessions/ingest', 'POST', admin, { id: 'quality-1', messages: [] })).status, 200);
  assert.equal((await server.client.query("SELECT count(*)::int AS count FROM session_quality_flags WHERE session_id='quality-1' AND detected_at='2020-01-01T00:00:00Z'")).rows[0].count, 2);
});

test('a JSON import into an already migrated database receives quality flags', async t => {
  const fixture = basicFixture();
  fixture.sessions.push({ id: 'imported-quality', userId: 'chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [
    { id: 'imported-a', role: 'assistant', content: '我无法回答', at: new Date().toISOString(), usage: { promptTokens: 1, completionTokens: 2001 } },
  ] });
  const server = await createPgTestServer(t, fixture);
  assert.deepEqual((await server.client.query("SELECT flag_type FROM session_quality_flags WHERE session_id='imported-quality' ORDER BY flag_type")).rows.map(row => row.flag_type), ['excessive_length', 'rejection']);
});
