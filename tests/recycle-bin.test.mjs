import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';
import { runRetentionCleanup } from '../mock/retention.mjs';

async function login(base, username, password) {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return (await response.json()).token;
}
async function request(base, token, method, path, body) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}

test('core content is hidden, restorable, and purged with its child records', async t => {
  const { base, client } = await createPgTestServer(t);
  const admin = await login(base, 'admin', 'admin123');
  const member = await login(base, 'member', 'test');
  await client.query("INSERT INTO time_entries(id,task_id,duration_minutes) VALUES('recycle-time','seed-task-1',60)");
  const note = await request(base, admin, 'POST', '/notes', { title: '回收笔记', content: '正文' });
  assert.equal(note.status, 201);
  const experiment = await request(base, admin, 'POST', '/experiments', { title: '回收实验' });
  assert.equal(experiment.status, 201);
  const resources = [
    { type: 'task', id: 'seed-task-1', title: '起始任务', path: '/tasks' },
    { type: 'note', id: note.data.id, title: '回收笔记', path: '/notes' },
    { type: 'experiment', id: experiment.data.id, title: '回收实验', path: '/experiments' },
  ];
  for (const item of resources) assert.equal((await request(base, admin, 'DELETE', `${item.path}/${item.id}`)).status, 200);
  const bin = await request(base, admin, 'GET', '/settings/recycle-bin');
  assert.equal(bin.status, 200);
  for (const item of resources) {
    assert.ok(bin.data.items.some(row => row.type === item.type && row.id === item.id));
    assert.equal((await request(base, admin, 'GET', `${item.path}/${item.id}`)).status, 404);
  }
  assert.equal((await request(base, member, 'GET', '/settings/recycle-bin')).status, 403);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM time_entries WHERE id='recycle-time'")).rows[0].n, 1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM note_versions WHERE note_id=$1', [note.data.id])).rows[0].n, 1);
  assert.equal((await request(base, admin, 'POST', `/settings/recycle-bin/task/seed-task-1/restore`)).status, 200);
  assert.equal((await request(base, admin, 'GET', '/tasks/seed-task-1')).status, 200);
  assert.equal((await request(base, admin, 'POST', `/settings/recycle-bin/note/${note.data.id}/restore`)).status, 200);
  assert.equal((await request(base, admin, 'GET', `/notes/${note.data.id}`)).status, 200);
  assert.equal((await request(base, admin, 'POST', `/settings/recycle-bin/experiment/${experiment.data.id}/purge`, { confirmTitle: 'wrong' })).status, 400);
  assert.equal((await request(base, admin, 'POST', `/settings/recycle-bin/experiment/${experiment.data.id}/purge`, { confirmTitle: '回收实验' })).status, 200);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM experiments WHERE id=$1', [experiment.data.id])).rows[0].n, 0);
});

test('restoring multiple deleted predecessors rebuilds untouched dependent edges and history', async t => {
  const { base, client } = await createPgTestServer(t);
  const admin = await login(base, 'admin', 'admin123');
  await client.query("INSERT INTO tasks(id,title,status,owner_id,version,description) VALUES('recycle-a','前置 A','todo','admin',1,''),('recycle-b','前置 B','todo','admin',1,''),('recycle-c','下游任务','in_progress','admin',1,'')");
  await client.query("INSERT INTO task_dependencies(task_id,dependency_id,item_order) VALUES('recycle-c','recycle-a',0),('recycle-c','recycle-b',1)");
  const deleted = await request(base,admin,'POST','/tasks/bulk',{ ids: ['recycle-a','recycle-b'], versions: { 'recycle-a': 1, 'recycle-b': 1 }, action: 'delete' });
  assert.equal(deleted.status,200);
  assert.deepEqual((await request(base,admin,'GET','/tasks/recycle-c')).data.dependencyIds,[]);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM task_dependency_restore_edges WHERE dependent_task_id='recycle-c'")).rows[0].n,2);
  const first = await request(base,admin,'POST','/settings/recycle-bin/task/recycle-b/restore');
  assert.equal(first.status,200);
  assert.equal(first.data.restoredDependencies,1);
  assert.deepEqual(first.data.skippedDependencies,[]);
  assert.deepEqual((await request(base,admin,'GET','/tasks/recycle-c')).data.dependencyIds,['recycle-b']);
  const second = await request(base,admin,'POST','/settings/recycle-bin/task/recycle-a/restore');
  assert.equal(second.status,200);
  assert.equal(second.data.restoredDependencies,1);
  assert.deepEqual((await request(base,admin,'GET','/tasks/recycle-c')).data.dependencyIds,['recycle-a','recycle-b']);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM change_logs WHERE task_id='recycle-c' AND field_name='dependencyIds'")).rows[0].n,3);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM task_dependency_restore_edges WHERE dependent_task_id='recycle-c'")).rows[0].n,0);
});

test('restore reports dependent tasks changed after deletion instead of overwriting their dependencies', async t => {
  const { base, client } = await createPgTestServer(t);
  const admin = await login(base, 'admin', 'admin123');
  await client.query("INSERT INTO tasks(id,title,status,owner_id,version,description) VALUES('recycle-other','其他前置','todo','admin',1,'')");
  await client.query("INSERT INTO task_dependencies(task_id,dependency_id,item_order) VALUES('seed-task-2','seed-task-1',0)");
  assert.equal((await request(base,admin,'DELETE','/tasks/seed-task-1')).status,200);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM task_dependency_restore_edges WHERE deleted_task_id='seed-task-1'")).rows[0].n,1);
  assert.equal((await request(base,admin,'PATCH','/tasks/seed-task-2',{ dependencyIds: ['recycle-other'] })).status,200);
  const restored = await request(base,admin,'POST','/settings/recycle-bin/task/seed-task-1/restore');
  assert.equal(restored.status,200);
  assert.equal(restored.data.restoredDependencies,0);
  assert.deepEqual(restored.data.skippedDependencies,[{ taskId: 'seed-task-2', reason: '关联任务的依赖已被修改' }]);
  assert.deepEqual((await request(base,admin,'GET','/tasks/seed-task-2')).data.dependencyIds,['recycle-other']);
});

test('restoration waits for a deleted dependent task and reconnects when it is restored', async t => {
  const { base, client } = await createPgTestServer(t);
  const admin = await login(base, 'admin', 'admin123');
  await client.query("INSERT INTO task_dependencies(task_id,dependency_id,item_order) VALUES('seed-task-2','seed-task-1',0)");
  assert.equal((await request(base,admin,'DELETE','/tasks/seed-task-1')).status,200);
  assert.equal((await request(base,admin,'DELETE','/tasks/seed-task-2')).status,200);
  const parent = await request(base,admin,'POST','/settings/recycle-bin/task/seed-task-1/restore');
  assert.equal(parent.status,200);
  assert.equal(parent.data.restoredDependencies,0);
  assert.equal(parent.data.deferredDependencies,1);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM task_dependency_restore_edges WHERE deleted_task_id='seed-task-1'")).rows[0].n,1);
  const child = await request(base,admin,'POST','/settings/recycle-bin/task/seed-task-2/restore');
  assert.equal(child.status,200);
  assert.equal(child.data.restoredDependencies,1);
  assert.deepEqual((await request(base,admin,'GET','/tasks/seed-task-2')).data.dependencyIds,['seed-task-1']);
});

test('restore refuses a dependency cycle and purge removes pending restoration edges', async t => {
  const { base, client } = await createPgTestServer(t);
  const admin = await login(base, 'admin', 'admin123');
  await client.query("INSERT INTO task_dependencies(task_id,dependency_id,item_order) VALUES('seed-task-2','seed-task-1',0)");
  assert.equal((await request(base,admin,'DELETE','/tasks/seed-task-1')).status,200);
  await client.query("INSERT INTO task_dependencies(task_id,dependency_id,item_order) VALUES('seed-task-1','seed-task-2',0)");
  const restored = await request(base,admin,'POST','/settings/recycle-bin/task/seed-task-1/restore');
  assert.equal(restored.status,200);
  assert.equal(restored.data.restoredDependencies,0);
  assert.match(restored.data.skippedDependencies[0].reason,/循环依赖/);
  assert.deepEqual((await request(base,admin,'GET','/tasks/seed-task-2')).data.dependencyIds,[]);
  await client.query("DELETE FROM task_dependencies WHERE task_id='seed-task-1'");
  await client.query("INSERT INTO task_dependencies(task_id,dependency_id,item_order) VALUES('seed-task-2','seed-task-1',0)");
  assert.equal((await request(base,admin,'DELETE','/tasks/seed-task-1')).status,200);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM task_dependency_restore_edges WHERE deleted_task_id='seed-task-1'")).rows[0].n,1);
  assert.equal((await request(base,admin,'POST','/settings/recycle-bin/task/seed-task-1/purge',{ confirmTitle: '起始任务' })).status,200);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM task_dependency_restore_edges WHERE deleted_task_id='seed-task-1'")).rows[0].n,0);
});

test('expired recycle rows are purged once; zero-day policy deletes immediately', async t => {
  const { base, client } = await createPgTestServer(t);
  const admin = await login(base, 'admin', 'admin123');
  const worker = { connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };
  assert.equal((await request(base, admin, 'DELETE', '/tasks/seed-task-1')).status, 200);
  await client.query("UPDATE tasks SET deleted_at='2020-01-01T00:00:00Z' WHERE id='seed-task-1'");
  const result = await runRetentionCleanup(worker, new Date('2030-01-01T20:00:00Z'));
  assert.equal(result.purged.tasks, 1);
  assert.equal(await runRetentionCleanup(worker, new Date('2030-01-01T20:00:00Z')), null);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM tasks WHERE id='seed-task-1'")).rows[0].n, 0);
  const policy = (await request(base, admin, 'GET', '/settings/retention')).data;
  assert.equal((await request(base, admin, 'PUT', '/settings/retention', { ...policy, recycleDays: 0 })).status, 200);
  assert.equal((await request(base, admin, 'DELETE', '/tasks/seed-task-2')).status, 200);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM tasks WHERE id='seed-task-2'")).rows[0].n, 0);
});
