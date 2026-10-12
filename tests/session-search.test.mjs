import test from 'node:test';
import assert from 'node:assert/strict';
import { basicFixture, createPgTestServer } from './pg-helper.mjs';

test('session search scans all messages and returns Unicode context with session metadata', async t => {
  const fixture = basicFixture();
  const at = new Date().toISOString();
  fixture.sessions = [
    { id: 'search-a', userId: 'chat-user', createdAt: at, updatedAt: at, messages: [
      { id: 'question', role: 'user', content: '关于会话搜索', at },
      { id: 'answer', role: 'assistant', content: `${'😀'.repeat(35)}React${'中'.repeat(35)}`, at },
    ] },
    { id: 'search-b', userId: 'another', createdAt: at, updatedAt: at, messages: [
      { id: 'percent', role: 'user', content: '进度 20%_完成', at },
    ] },
  ];
  const { base } = await createPgTestServer(t, fixture);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const search = async params => {
    const response = await fetch(`${base}/sessions/search?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await fetch(`${base}/sessions/search?query=React`)).status, 401);
  const word = await search({ query: 'react' });
  assert.equal(word.status, 200);
  assert.equal(word.data.items.length, 1);
  assert.equal(word.data.items[0].sessionId, 'search-a');
  assert.equal(word.data.items[0].sessionTitle, '关于会话搜索');
  assert.equal(word.data.items[0].at, at);
  assert.equal(Array.from(word.data.items[0].snippet.before.replace(/^…/, '')).length, 30);
  assert.equal(Array.from(word.data.items[0].snippet.after.replace(/…$/, '')).length, 30);
  assert.equal(word.data.items[0].snippet.match, 'React');
  assert.equal((await search({ query: '%_' })).data.items[0].messageId, 'percent');
  assert.equal((await search({ query: 'REACT|20%', regex: 'true' })).data.items.length, 2);
  assert.equal((await search({ query: '[', regex: 'true' })).status, 400);
  assert.equal((await search({ query: '', regex: 'false' })).status, 400);
});

test('session search pages matches without loading full transcripts', async t => {
  const { base, client } = await createPgTestServer(t);
  const at = new Date().toISOString();
  await client.query("INSERT INTO sessions(id,external_user_id,created_at,updated_at) SELECT 'page-'||i,'external',$1,$1 FROM generate_series(1,25) i", [at]);
  await client.query("INSERT INTO session_messages(session_id,id,role,content,at,item_order) SELECT 'page-'||i,'message-'||i,'user','needle '||i,$1,0 FROM generate_series(1,25) i", [at]);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const page = async value => (await (await fetch(`${base}/sessions/search?query=needle&page=${value}`, { headers: { Authorization: `Bearer ${token}` } })).json());
  const first = await page(1), second = await page(2);
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 5);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.messageId)).size, 25);
});
