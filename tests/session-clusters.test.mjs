import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterSessions } from '../mock/session-clusters.mjs';
import { basicFixture, createPgTestServer } from './pg-helper.mjs';
import pg from 'pg';
import { runRetentionCleanup } from '../mock/retention.mjs';

test('TF-IDF and deterministic K-means separate first-question topics', () => {
  const rows = [
    { id: 'react-1', text: 'React Hooks 组件状态管理' },
    { id: 'react-2', text: 'React 组件 Hooks 状态更新' },
    { id: 'sql-1', text: 'PostgreSQL 数据库索引查询' },
    { id: 'sql-2', text: 'PostgreSQL 索引优化数据库查询' },
  ];
  const first = clusterSessions(rows, 2);
  const again = clusterSessions([...rows].reverse(), 2);
  assert.deepEqual(first.assignments, again.assignments);
  assert.equal(first.assignments['react-1'], first.assignments['react-2']);
  assert.equal(first.assignments['sql-1'], first.assignments['sql-2']);
  assert.notEqual(first.assignments['react-1'], first.assignments['sql-1']);
  assert.ok(first.clusters.every(item => item.label.split(' · ').length <= 3));
  assert.equal(clusterSessions(rows, 1).clusters.length, 1);
});

test('cluster settings, list filtering, manual labels and new session assignment persist', async t => {
  const fixture = basicFixture();
  const at = new Date().toISOString();
  fixture.sessions = [
    { id: 'react-1', userId: 'chat', createdAt: at, updatedAt: at, messages: [{ id: 'r1', role: 'user', content: 'React Hooks 组件状态管理', at }] },
    { id: 'react-2', userId: 'chat', createdAt: at, updatedAt: at, messages: [{ id: 'r2', role: 'user', content: 'React Hooks 状态更新', at }] },
    { id: 'sql-1', userId: 'chat', createdAt: at, updatedAt: at, messages: [{ id: 's1', role: 'user', content: 'PostgreSQL 数据库索引查询', at }] },
    { id: 'sql-2', userId: 'chat', createdAt: at, updatedAt: at, messages: [{ id: 's2', role: 'user', content: 'PostgreSQL 索引优化数据库查询', at }] },
  ];
  const server = await createPgTestServer(t, fixture);
  const request = async (path, method = 'GET', token = '', body) => {
    const response = await fetch(`${server.base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const admin = (await request('/auth/login', 'POST', '', { username: 'admin', password: 'admin123' })).data.token;
  const member = (await request('/auth/login', 'POST', '', { username: 'member', password: 'test' })).data.token;
  const initial = await request('/sessions/clusters', 'GET', admin);
  assert.equal(initial.data.requestedK, 'auto');
  assert.equal(initial.data.items.length, 2);
  assert.equal((await request('/sessions/clusters', 'GET', member)).data.items.length, 0);
  assert.equal((await request('/sessions/clusters/config', 'PUT', member, { k: 2 })).status, 403);
  assert.equal((await request('/sessions/clusters/config', 'PUT', admin, { k: 0 })).status, 422);
  assert.equal((await request('/sessions/clusters/config', 'PUT', admin, { k: 2 })).status, 200);
  const clusterList = await request('/sessions/clusters', 'GET', admin);
  assert.equal(clusterList.data.items.length, 2);
  const sessions = (await request('/sessions', 'GET', admin)).data.items;
  const reactCluster = sessions.find(item => item.id === 'react-1').clusterId;
  assert.equal(sessions.find(item => item.id === 'react-2').clusterId, reactCluster);
  assert.notEqual(sessions.find(item => item.id === 'sql-1').clusterId, reactCluster);
  assert.equal((await request(`/sessions?clusterId=${reactCluster}`, 'GET', member)).data.items.length, 0);
  assert.equal((await request('/sessions?clusterId=missing', 'GET', member)).status, 400);
  assert.equal((await request(`/sessions/clusters/${reactCluster}`, 'PATCH', member, { label: '前端专题' })).status, 403);
  assert.equal((await request(`/sessions/clusters/${reactCluster}`, 'PATCH', admin, { label: '前端专题' })).status, 200);
  assert.equal((await request(`/sessions?clusterId=${reactCluster}`, 'GET', admin)).data.items[0].clusterLabel, '前端专题');
  const created = await request('/sessions/ingest', 'POST', member, { id: 'react-3', userId: 'chat', messages: [{ id: 'r3', role: 'user', content: 'React Hooks 组件状态' }] });
  assert.equal(created.status, 201);
  assert.equal((await request('/sessions/clusters', 'GET', member)).data.items.length, 1);
  assert.equal((await request(`/sessions?clusterId=${reactCluster}`, 'GET', member)).data.items.length, 1);
  const after = (await request('/sessions', 'GET', admin)).data.items;
  assert.equal(after.find(item => item.id === 'react-3').clusterId, reactCluster);
  assert.equal((await request('/sessions/clusters', 'GET', admin)).data.items.find(item => item.id === reactCluster).label, '前端专题');
  assert.equal((await request('/sessions/clusters/rebuild', 'POST', member)).status, 403);
  assert.equal((await request('/sessions/clusters/rebuild', 'POST', admin)).status, 200);
  assert.equal((await request('/sessions/clusters', 'GET', admin)).data.items.find(item => item.id === reactCluster).label, '前端专题');
  await server.client.query("UPDATE sessions SET created_at='2020-01-01T00:00:00Z' WHERE id='react-1'");
  const cleanupPool = new pg.Pool({ connectionString: server.url });
  let cleanup;
  try { cleanup = await runRetentionCleanup(cleanupPool, new Date(Date.now() + 86_400_000), true); }
  finally { await cleanupPool.end(); }
  assert.equal(cleanup.sessionsDeleted, 1);
  const clusterCounts = (await request('/sessions/clusters', 'GET', admin)).data.items.reduce((sum, item) => sum + item.memberCount, 0);
  assert.equal(clusterCounts, 4);
});
