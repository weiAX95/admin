import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import ts from 'typescript';
import { initializeTaskTrends, recordTaskTrendEvent, recordTaskTrendSnapshot, computeTaskTrends, trendDateKey } from '../mock/task-trends.mjs';
import { createPgTestServer, basicFixture } from './pg-helper.mjs';
import { loadData } from '../mock/postgres-store.mjs';

const source = fs.readFileSync(new URL('../src/utils/taskTrends.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { aggregateTaskTrends } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const makeDb = () => ({ tasks: [{ id: 'old', createdAt: '2026-09-01T03:00:00Z', progress: 40 }], activity: [{ type: 'complete', taskId: 'old', at: '2026-09-02T03:00:00Z' }] });

test('legacy migration preserves counts and leaves unknown historical progress empty', () => {
  const db = makeDb();
  assert.equal(initializeTaskTrends(db, '2026-09-03T03:00:00Z'), true);
  assert.equal(initializeTaskTrends(db, '2026-09-04T03:00:00Z'), false);
  const { items } = computeTaskTrends(db, { start: '2026-09-01', end: '2026-09-04' }, '2026-09-04T12:00:00Z');
  assert.deepEqual(items.map(p => [p.created, p.completed, p.avgProgress]), [[1, 0, null], [0, 1, null], [0, 0, 40], [0, 0, 40]]);
});

test('progress carries across query boundaries and tracks updates/deletions without losing counts', () => {
  const db = makeDb(); initializeTaskTrends(db, '2026-09-03T03:00:00Z');
  db.tasks[0].progress = 80; recordTaskTrendSnapshot(db, '2026-09-04T03:00:00Z');
  db.tasks.push({ id: 'new', progress: 20 }); recordTaskTrendEvent(db, 'create', 'new', '2026-09-04T04:00:00Z'); recordTaskTrendSnapshot(db, '2026-09-04T04:00:00Z');
  db.tasks.splice(0, 1); recordTaskTrendSnapshot(db, '2026-09-05T03:00:00Z'); db.activity = [];
  const { items } = computeTaskTrends(db, { start: '2026-09-04', end: '2026-09-06' }, '2026-09-06T12:00:00Z');
  assert.deepEqual(items.map(p => p.avgProgress), [50, 20, 20]);
  assert.equal(items[0].created, 1);
  assert.equal(computeTaskTrends(db, { start: '2026-09-01', end: '2026-09-06' }, '2026-09-06T12:00:00Z').items[0].created, 1);
});

test('Shanghai midnight, empty/future windows and invalid ranges', () => {
  assert.equal(trendDateKey('2026-09-01T16:00:00Z'), '2026-09-02');
  const db = { tasks: [], activity: [] }; initializeTaskTrends(db, '2026-09-03T03:00:00Z');
  assert.ok(computeTaskTrends(db, { start: '2026-09-01', end: '2026-09-04' }, '2026-09-04T12:00:00Z').items.every(p => p.created === 0 && p.completed === 0 && p.avgProgress === null));
  assert.deepEqual(computeTaskTrends(db, { start: '2027-01-01', end: '2027-01-10' }, '2026-09-04T12:00:00Z').items, []);
  assert.throws(() => computeTaskTrends(db, { start: '2026-02-30', end: '2026-03-01' }));
  assert.throws(() => computeTaskTrends(db, { start: '2026-09-04', end: '2026-09-03' }));
  assert.throws(() => computeTaskTrends(db, { start: '2000-01-01', end: '2026-01-01' }));
});

test('weekly and monthly counts sum while progress uses the period end, including zero', () => {
  const points = [
    { date: '2026-09-06', created: 1, completed: 2, avgProgress: 20 }, // Sunday
    { date: '2026-09-07', created: 2, completed: 1, avgProgress: 80 }, // Monday
    { date: '2026-09-08', created: 3, completed: 2, avgProgress: 0 },
    { date: '2026-10-01', created: 4, completed: 3, avgProgress: 50 },
  ];
  const weeks = aggregateTaskTrends(points, 'week');
  assert.deepEqual(weeks.map(p => [p.created, p.completed, p.avgProgress]), [[1, 2, 20], [5, 3, 0], [4, 3, 50]]);
  const months = aggregateTaskTrends(points, 'month');
  assert.deepEqual(months.map(p => [p.created, p.completed, p.avgProgress]), [[6, 5, 0], [4, 3, 50]]);
  assert.equal(aggregateTaskTrends(points, 'day').length, 4);
  assert.deepEqual(aggregateTaskTrends([], 'month'), []);
});

test('API tracks create, complete, batch import and deletion, and persists independent history', async t => {
    const fixture = basicFixture();
    fixture.tasks = []; fixture.activity = []; fixture.legacyActivityIds = [];
    fixture.users = fixture.users.filter(user => user.username !== 'learner').map(user => ({ ...user, password: 'test' }));
    const { port, client } = await createPgTestServer(t, fixture);
    let token;
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
    };
    token = (await call('/auth/login', 'POST', { username: 'admin', password: 'test' })).token;
    const live = new WebSocket(`ws://127.0.0.1:${port}/api/live`);
    await once(live, 'open');
    live.send(JSON.stringify({ type: 'auth', token }));
    assert.deepEqual(JSON.parse(String((await once(live, 'message'))[0])), { type: 'ready' });
    const changed = once(live, 'message');

    const today = trendDateKey(new Date());
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const task = await call('/tasks', 'POST', { title: 'Task', progress: 20, dueDate: yesterday });
    assert.deepEqual(JSON.parse(String((await changed)[0])), { type: 'stats_changed' });
    live.close();
    const overdueStats = await call('/stats');
    assert.deepEqual(overdueStats.overdue, [{ id: task.id, title: 'Task', dueDate: yesterday, status: 'todo', overdueDays: 1, severity: 'warning' }]);
    await call(`/tasks/${task.id}`, 'PATCH', { progress: 80 });
    await call(`/tasks/${task.id}`, 'PATCH', { status: 'done', progress: 100 });
    await call(`/tasks/${task.id}`, 'PATCH', { status: 'done', progress: 100 });
    await call('/tasks/import', 'POST', { tasks: [{ title: 'Imported', progress: 50 }, { title: 'Imported done', status: 'done', progress: 100 }] });
    await call(`/tasks/${task.id}`, 'DELETE');
    const stats = await call(`/stats?start=${today}&end=${today}`);
    assert.deepEqual(stats.overdue, []);
    assert.ok(stats.byCategory.flatMap(category => category.tasks).every(task => task.phase === '基础'));
    assert.deepEqual(stats.trends.items, [{ date: today, created: 3, completed: 2, avgProgress: 75 }]);
    const activities = await call('/activity?limit=2&userId=admin');
    assert.equal(activities.items.length, 2);
    assert.ok(activities.items.every(a => a.username === 'admin' && a.userId === 'admin'));
    assert.ok(activities.nextCursor);
    const nextActivities = await call(`/activity?limit=2&userId=admin&cursor=${activities.nextCursor}`);
    assert.ok(nextActivities.items.every(a => !activities.items.some(b => b.id === a.id)));
    assert.equal((await call('/activity?type=complete')).total, 1);
    const dayDetail = await call(`/activity/day?date=${today}`);
    assert.equal(dayDetail.completed, 1);
    assert.equal(dayDetail.created, 2);
    assert.ok(dayDetail.items.length >= 2);
    assert.equal((await call(`/activity/heatmap?start=${today}&end=${today}`)).items.length, 1);
    const quickCounts = await call('/dashboard/quick-actions');
    assert.deepEqual(quickCounts, { tasks: 2, sessions: 0, notes: 0 });
    const taskPreview = await call('/dashboard/quick-preview?kind=tasks');
    assert.equal(taskPreview.items.length, 2);
    assert.ok(taskPreview.items.every(item => Object.keys(item).sort().join(',') === 'id,title'));
    assert.deepEqual((await call('/dashboard/quick-preview?kind=sessions')).items, []);
    const persisted = await loadData(client);
    persisted.activity = [];
    assert.equal(computeTaskTrends(persisted, { start: today, end: today }).items[0].created, 3);
    assert.equal(persisted.taskTrendEvents.filter(e => e.type === 'complete').length, 2);
    const withChecklist = await call('/tasks', 'POST', { title: 'Checklist task', category: '清单分类', progress: 35, tags: ['必学', '长期'], checklist: [{ text: 'Step A' }, { text: 'Step B' }] });
    assert.equal(withChecklist.progress, 0);
    assert.equal(withChecklist.manualProgress, 35);
    assert.deepEqual(withChecklist.checklist.map(item => item.order), [0, 1]);
    const filteredTasks = await call('/tasks?status=done');
    assert.ok(filteredTasks.categories.includes('清单分类'));
    assert.ok(filteredTasks.tags.includes('必学'));
    assert.ok(filteredTasks.items.every(item => item.effectiveStatus === 'done'));
    assert.equal((await call('/tasks?tag=必学&tag=长期')).items.some(item => item.id === withChecklist.id), true);
    assert.equal((await call('/tasks?tag=必学&tag=紧急')).items.some(item => item.id === withChecklist.id), false);
    const tagged = await call(`/tasks/${withChecklist.id}/tags`, 'PUT', { version: withChecklist.version, tags: ['复习', '复习', '紧急'] });
    assert.deepEqual(tagged.tags, ['复习', '紧急']);
    const tagConflict = await fetch(`http://127.0.0.1:${port}/api/tasks/${withChecklist.id}/tags`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ version: withChecklist.version, tags: [] }) });
    assert.equal(tagConflict.status, 409);
    const manyTags = await call('/tasks', 'POST', { title: 'Many tags', tags: Array.from({ length: 40 }, (_, index) => `标签${index}`) });
    assert.equal(manyTags.tags.length, 40);
    assert.deepEqual((await call(`/tasks/${manyTags.id}/tags`, 'PUT', { version: manyTags.version, tags: [] })).tags, []);
    const firstDone = await call(`/tasks/${withChecklist.id}/checklist`, 'PUT', { version: tagged.version, checklist: tagged.checklist.map((item, index) => ({ ...item, done: index === 0 })) });
    assert.equal(firstDone.progress, 50);
    const reordered = await call(`/tasks/${withChecklist.id}/checklist`, 'PUT', { version: firstDone.version, checklist: [...firstDone.checklist].reverse() });
    assert.deepEqual(reordered.checklist.map(item => [item.text, item.order]), [['Step B', 0], ['Step A', 1]]);
    const stale = await fetch(`http://127.0.0.1:${port}/api/tasks/${withChecklist.id}/checklist`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ version: withChecklist.version, checklist: [] }) });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).latest.progress, 50);
    const allDone = await call(`/tasks/${withChecklist.id}/checklist`, 'PUT', { version: reordered.version, checklist: reordered.checklist.map(item => ({ ...item, done: true })) });
    assert.equal(allDone.progress, 100);
    assert.equal(allDone.status, 'todo');
    const markedDone = await call(`/tasks/${withChecklist.id}`, 'PATCH', { status: 'done' });
    const reopened = await call(`/tasks/${withChecklist.id}/checklist`, 'PUT', { version: markedDone.version, checklist: markedDone.checklist.map((item, index) => ({ ...item, done: index !== 0 })) });
    assert.equal(reopened.status, 'in_progress');
    assert.equal(reopened.progress, 50);
    assert.ok((await call(`/tasks/${withChecklist.id}/activity`)).items.some(item => item.detail.includes('状态恢复为进行中')));
    const template = await call('/task-templates', 'POST', { taskId: withChecklist.id, name: 'Saved template' });
    assert.deepEqual(template.checklist, ['Step B', 'Step A']);
    assert.ok((await call('/task-templates')).items.some(item => item.id === template.id));
    const fromTemplate = await call('/tasks', 'POST', { title: template.name, description: template.description, phase: template.defaultPhase, priority: template.defaultPriority, resources: template.suggestedResources, checklist: template.checklist.map(text => ({ text })) });
    assert.equal(fromTemplate.checklist.length, 2);
    assert.equal(fromTemplate.progress, 0);
    const empty = await call(`/tasks/${withChecklist.id}/checklist`, 'PUT', { version: reopened.version, checklist: [] });
    assert.equal(empty.progress, 35);
    const editedManual = await call(`/tasks/${withChecklist.id}`, 'PATCH', { progress: 67 });
    assert.equal(editedManual.progress, 67);
    const addedAgain = await call(`/tasks/${withChecklist.id}/checklist`, 'PUT', { version: editedManual.version, checklist: [{ text: 'New step' }] });
    assert.equal(addedAgain.progress, 0);
    const clearedAgain = await call(`/tasks/${withChecklist.id}/checklist`, 'PUT', { version: addedAgain.version, checklist: [] });
    assert.equal(clearedAgain.progress, 67);

    const prerequisite = await call('/tasks', 'POST', { title: 'Prerequisite', status: 'todo', plannedStartDate: '2026-10-01', dueDate: '2026-10-03' });
    const dependent = await call('/tasks', 'POST', { title: 'Dependent', status: 'todo', dependencyIds: [prerequisite.id], plannedStartDate: '2026-10-04', dueDate: '2026-10-07' });
    assert.equal(dependent.status, 'todo');
    assert.equal(dependent.effectiveStatus, 'blocked');
    assert.deepEqual(dependent.blockedBy.map(item => item.id), [prerequisite.id]);
    const beforeViewing = JSON.stringify(await loadData(client));
    await call('/tasks'); await call(`/tasks/${dependent.id}`);
    assert.equal(JSON.stringify(await loadData(client)), beforeViewing);
    const rejected = async (route, method, body, expected) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${route}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, expected);
    };
    await rejected(`/tasks/${prerequisite.id}`, 'PATCH', { dependencyIds: [dependent.id] }, /循环依赖/);
    const third = await call('/tasks', 'POST', { title: 'Third level', dependencyIds: [dependent.id] });
    await rejected(`/tasks/${prerequisite.id}`, 'PATCH', { dependencyIds: [third.id] }, /循环依赖/);
    await rejected(`/tasks/${dependent.id}`, 'PATCH', { dependencyIds: [dependent.id] }, /依赖自身/);
    await rejected(`/tasks/${dependent.id}`, 'PATCH', { plannedStartDate: '2026-10-08' }, /不能早于/);
    await rejected('/tasks', 'POST', { title: 'Invalid plan', plannedStartDate: '2026-10-08', dueDate: '2026-10-07' }, /不能早于/);
    const finished = await call(`/tasks/${prerequisite.id}`, 'PATCH', { status: 'done' });
    assert.equal(finished.effectiveStatus, 'done');
    assert.equal((await call(`/tasks/${dependent.id}`)).effectiveStatus, 'todo');
    assert.equal((await call(`/tasks/${dependent.id}/activity`)).items.filter(item => item.detail.includes('依赖阻塞已解除')).length, 1);
    await call(`/tasks/${dependent.id}`, 'PATCH', { status: 'blocked' });
    await call(`/tasks/${prerequisite.id}`, 'PATCH', { status: 'in_progress' });
    await call(`/tasks/${prerequisite.id}`, 'PATCH', { status: 'done' });
    assert.equal((await call(`/tasks/${dependent.id}`)).effectiveStatus, 'blocked');
    assert.equal((await call(`/tasks/${dependent.id}/activity`)).items.filter(item => item.detail.includes('依赖阻塞已解除')).length, 1);
    await call(`/tasks/${prerequisite.id}`, 'DELETE');
    assert.deepEqual((await call(`/tasks/${dependent.id}`)).dependencyIds, []);
    assert.equal((await call(`/tasks/${dependent.id}`)).effectiveStatus, 'blocked');
    const other = await call('/tasks', 'POST', { title: 'For deletion' });
    const otherDependent = await call('/tasks', 'POST', { title: 'Unblocked on delete', dependencyIds: [other.id] });
    assert.equal(otherDependent.effectiveStatus, 'blocked');
    await call(`/tasks/${other.id}`, 'DELETE');
    assert.equal((await call(`/tasks/${otherDependent.id}`)).effectiveStatus, 'todo');
    assert.equal((await call(`/tasks/${otherDependent.id}/activity`)).items.filter(item => item.detail.includes('依赖阻塞已解除')).length, 1);
    const memberToken = (await call('/auth/login', 'POST', { username: 'member', password: 'test' })).token;
    const memberOptions = await fetch(`http://127.0.0.1:${port}/api/tasks/dependency-options`, { headers: { Authorization: `Bearer ${memberToken}` } }).then(response => response.json());
    assert.ok(!memberOptions.items.some(item => item.id === dependent.id));
    const foreign = await fetch(`http://127.0.0.1:${port}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` }, body: JSON.stringify({ title: 'Cross permission', dependencyIds: [dependent.id] }) });
    assert.equal(foreign.status, 400);
    assert.match((await foreign.json()).error, /无权限/);
});
