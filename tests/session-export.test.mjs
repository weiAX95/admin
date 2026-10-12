import test from 'node:test';
import assert from 'node:assert/strict';
import { basicFixture, createPgTestServer } from './pg-helper.mjs';

test('selected sessions export complete ordered messages and annotations in JSON and Markdown', async t => {
  const fixture = basicFixture();
  const at = new Date().toISOString();
  fixture.sessions = [
    { id: 'export-a', userId: 'external-chat-user', createdAt: at, updatedAt: at, messages: [
      { id: 'question', role: 'user', content: '你好', at },
      { id: 'answer', role: 'assistant', content: '回复 ```code```\n第二行', at },
    ] },
    { id: 'export-b', userId: 'other-user', createdAt: at, updatedAt: at, messages: [] },
  ];
  const { base, client } = await createPgTestServer(t, fixture);
  await client.query("UPDATE sessions SET ingested_by='member' WHERE id='export-a'");
  const login = async (username, password) => {
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return (await response.json()).token;
  };
  const admin = await login('admin', 'admin123');
  const member = await login('member', 'test');
  const annotate = async (token, rating, tags) => fetch(`${base}/sessions/export-a/messages/answer/annotation`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, tags }) });
  assert.equal((await annotate(admin, 5, ['准确'])).status, 200);
  assert.equal((await annotate(member, 4, ['准确', '过于冗长'])).status, 200);
  const request = (token, ids, format) => fetch(`${base}/sessions/export`, { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, format }) });
  assert.equal((await request(null, ['export-a'], 'json')).status, 401);
  assert.equal((await request(member, ['export-b', 'export-a'], 'json')).status, 404);
  const response = await request(admin, ['export-b', 'export-a'], 'json');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="sessions-.*\.json"/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const output = await response.json();
  assert.deepEqual(output.sessions.map(session => session.id), ['export-b', 'export-a']);
  assert.equal(output.sessions[0].messages.length, 0);
  assert.equal(output.sessions[1].userId, 'external-chat-user');
  assert.deepEqual(output.sessions[1].messages.map(item => item.id), ['question', 'answer']);
  assert.equal(output.sessions[1].messages[1].content, '回复 ```code```\n第二行');
  assert.deepEqual(output.sessions[1].messages[1].annotations.map(item => item.rating).sort(), [4, 5]);
  assert.ok(output.sessions[1].messages[1].annotations.every(item => 'reviewerId' in item));
  const adminJson = await (await request(admin, ['export-a'], 'json')).json();
  assert.deepEqual(new Set(adminJson.sessions[0].messages[1].annotations.map(item => item.reviewerId)), new Set(['admin', 'member']));
  const memberJson = await (await request(member, ['export-a'], 'json')).json();
  assert.ok(memberJson.sessions[0].messages[1].annotations.every(item => !('reviewerId' in item)));
  const markdown = await (await request(member, ['export-a'], 'markdown')).text();
  assert.match(markdown, /## 会话 export-a/);
  assert.match(markdown, /````\n回复 ```code```\n第二行\n````/);
  assert.match(markdown, /标注：5\/5/);
  assert.match(markdown, /标注：4\/5/);
  assert.equal((await request(member, ['missing'], 'json')).status, 404);
  assert.equal((await request(member, ['export-a', 'export-a'], 'json')).status, 422);
  assert.equal((await request(member, [], 'json')).status, 422);
  assert.equal((await request(member, ['export-a'], 'pdf')).status, 422);
});
