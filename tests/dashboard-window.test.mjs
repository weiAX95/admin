import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDashboardWindow } from '../src/utils/dashboardWindow.ts';
import { basicFixture, createPgTestServer } from './pg-helper.mjs';

test('dashboard presets use Shanghai calendar dates and Monday-start weeks', () => {
  const sunday = new Date('2026-10-10T17:00:00Z'); // Shanghai Sunday, October 11
  assert.deepEqual(resolveDashboardWindow('today', null, sunday), { start: '2026-10-11', end: '2026-10-11' });
  assert.deepEqual(resolveDashboardWindow('week', null, sunday), { start: '2026-10-05', end: '2026-10-11' });
  assert.deepEqual(resolveDashboardWindow('month', null, sunday), { start: '2026-10-01', end: '2026-10-11' });
  assert.deepEqual(resolveDashboardWindow('30d', null, sunday), { start: '2026-09-12', end: '2026-10-11' });
  assert.deepEqual(resolveDashboardWindow('90d', null, sunday), { start: '2026-07-14', end: '2026-10-11' });
  assert.equal(resolveDashboardWindow('custom', null, sunday), null);
  assert.deepEqual(resolveDashboardWindow('custom', ['2024-01-01', '2024-12-31'], sunday), { start: '2024-01-01', end: '2024-12-31' });
  assert.equal(resolveDashboardWindow('custom', ['2024-01-01', '2025-01-01'], sunday), null);
  assert.equal(resolveDashboardWindow('custom', ['2026-10-12', '2026-10-11'], sunday), null);
});

test('stats window changes task cohort while cumulative overdue remains complete', async t => {
  const fixture = basicFixture();
  const today = resolveDashboardWindow('today', null).end;
  const old = new Date(Date.parse(`${today}T00:00:00Z`) - 5 * 86400000).toISOString().slice(0, 10);
  fixture.tasks[0].createdAt = `${old}T08:00:00Z`;
  fixture.tasks[0].updatedAt = `${old}T08:00:00Z`;
  fixture.tasks[0].dueDate = old;
  fixture.tasks[1].createdAt = `${today}T08:00:00Z`;
  fixture.tasks[1].updatedAt = `${today}T08:00:00Z`;
  fixture.tasks[1].dueDate = '';
  const { base } = await createPgTestServer(t, fixture);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const request = path => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const current = await (await request(`/stats?start=${today}&end=${today}`)).json();
  assert.equal(current.total, 1);
  assert.equal(current.byStatus.done, 1);
  assert.equal(current.byStatus.todo, 0);
  assert.equal(current.avgProgress, 100);
  assert.deepEqual(current.byCategory.map(item => item.category), ['进阶']);
  assert.equal(current.heatmap.length, 1);
  assert.ok(current.overdue.some(item => item.id === 'seed-task-1'));
  const wider = await (await request(`/stats?start=${old}&end=${today}`)).json();
  assert.equal(wider.total, 2);
  assert.equal(wider.byStatus.todo, 1);
  assert.equal((await request(`/stats?start=${today}`)).status, 400);
  assert.equal((await request('/stats?start=2026-02-30&end=2026-03-01')).status, 400);
  assert.equal((await request('/stats?start=2024-01-01&end=2025-01-01')).status, 400);
});
