import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRelatedSessions } from '../mock/session-related.mjs';
import { basicFixture, createPgTestServer } from './pg-helper.mjs';

test('related sessions rank same-topic questions and exclude empty or unrelated content', () => {
  const base = { id: 'a', questions: ['React Hooks 原理'] };
  const ranked = rankRelatedSessions(base, [
    base,
    { id: 'b', title: 'React Hooks 性能优化', createdAt: '2026-01-02', questions: ['React Hooks 性能优化'] },
    { id: 'c', title: 'React 入门', createdAt: '2026-01-03', questions: ['React 入门'] },
    { id: 'd', title: 'Docker 容器', createdAt: '2026-01-04', questions: ['Docker 容器'] },
    { id: 'e', title: '空', createdAt: '2026-01-05', questions: [] },
  ]);
  assert.deepEqual(ranked.map(item => item.id), ['b', 'c']);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.equal(rankRelatedSessions({ id: 'empty', questions: [] }, [base]).length, 0);
});

test('related API only returns similar sessions belonging to same external user', async t => {
  const fixture = basicFixture();
  const at = new Date().toISOString();
  const make = (id, userId, content) => ({ id, userId, createdAt: at, updatedAt: at, messages: [{ id: `${id}-question`, role: 'user', content, at }] });
  fixture.sessions = [
    make('base', 'chat-a', 'React Hooks 原理'),
    make('similar', 'chat-a', 'React Hooks 性能优化'),
    make('unrelated', 'chat-a', 'Docker 容器部署'),
    make('other-user', 'chat-b', 'React Hooks 原理'),
  ];
  const { base } = await createPgTestServer(t, fixture);
  assert.equal((await fetch(`${base}/sessions/base/related`)).status, 401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const request = async id => fetch(`${base}/sessions/${id}/related`, { headers: { Authorization: `Bearer ${token}` } });
  const response = await request('base');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.items.map(item => item.id), ['similar']);
  assert.equal((await request('missing')).status, 404);
  const empty = await (await request('unrelated')).json();
  assert.deepEqual(empty.items, []);
});
