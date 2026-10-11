import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';

test('member cannot read or mutate another account task through task subroutes', async t => {
  const { base } = await createPgTestServer(t);
  const login = async (username, password) => (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json()).token;
  const admin = await login('admin', 'admin123');
  const member = await login('member', 'test');
  const request = async (token, method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const own = (await request(member, 'POST', '/tasks', { title: '成员任务' })).data;
  const linkedNote = (await request(admin, 'POST', '/notes', { title: '共享笔记', taskId: 'seed-task-1' })).data;
  const linkedExperiment = (await request(admin, 'POST', '/experiments', { title: '共享实验', taskId: 'seed-task-1' })).data;
  const model = await request(admin, 'POST', '/experiment-platform/models', { name: 'boundary-test', displayName: '权限测试模型', apiModel: 'boundary', inputUsdPerMillion: 1, outputUsdPerMillion: 1, allowedRoles: ['admin', 'member'] });
  assert.equal(model.status, 201);
  const definition = taskId => ({ title: '任务关联定义', taskId, systemPrompt: '', userPrompt: '测试', variables: {}, variants: [{ modelId: model.data.id, parameters: {} }] });
  const linkedDefinition = await request(admin, 'POST', '/experiment-definitions', definition('seed-task-1'));
  assert.equal(linkedDefinition.status, 201);
  assert.equal((await request(admin, 'GET', `/tasks/${own.id}`)).status, 200);
  assert.deepEqual((await request(member, 'GET', '/tasks')).data.items.map(item => item.id), [own.id]);
  const stats = (await request(member, 'GET', '/stats')).data;
  assert.equal(stats.total, 1);
  assert.ok(stats.trends.items.every(item => item.avgProgress === null));
  assert.equal((await request(member, 'GET', '/dashboard/quick-actions')).data.tasks, 1);
  assert.deepEqual((await request(member, 'GET', '/dashboard/quick-preview?kind=tasks')).data.items.map(item => item.id), [own.id]);
  assert.ok((await request(member, 'GET', '/activity')).data.items.every(item => item.taskId === own.id || item.userId === 'member'));
  assert.equal((await request(member, 'GET', `/notes/${linkedNote.id}`)).data.taskId, null);
  assert.equal((await request(member, 'GET', `/experiments/${linkedExperiment.id}`)).data.taskId, null);
  assert.equal((await request(member, 'GET', `/experiment-definitions/${linkedDefinition.data.id}`)).data.taskId, null);
  assert.equal((await request(member, 'POST', '/experiment-definitions', definition('seed-task-1'))).status, 404);
  assert.equal((await request(member, 'POST', '/experiment-definitions', definition(own.id))).status, 201);
  assert.equal((await request(member, 'GET', '/notes?taskId=seed-task-1')).status, 404);
  assert.equal((await request(member, 'GET', '/experiments?taskId=seed-task-1')).status, 404);
  assert.equal((await request(member, 'POST', '/notes', { title: '越权笔记', taskId: 'seed-task-1' })).status, 404);
  assert.equal((await request(member, 'POST', '/experiments', { title: '越权实验', taskId: 'seed-task-1' })).status, 404);
  assert.equal((await request(member, 'PATCH', `/notes/${linkedNote.id}`, { taskId: null })).status, 404);
  assert.equal((await request(member, 'DELETE', `/notes/${linkedNote.id}`)).status, 404);
  const graph = (await request(member, 'GET', '/knowledge-graph')).data;
  assert.ok(graph.nodes.every(node => node.id !== 'task:seed-task-1' && node.id !== 'task:seed-task-2'));
  for (const [method,path,body] of [
    ['GET','/tasks/seed-task-1'], ['PATCH','/tasks/seed-task-1',{ title: '越权' }], ['DELETE','/tasks/seed-task-1'],
    ['GET','/tasks/seed-task-1/change-logs'], ['GET','/tasks/seed-task-1/activity'], ['GET','/tasks/seed-task-1/time-entries'],
    ['POST','/tasks/seed-task-1/time-entries',{ mode: 'duration', workDate: '2026-10-11', hours: 1 }],
    ['PUT','/tasks/seed-task-1/checklist',{ version: 1, checklist: [] }], ['PUT','/tasks/seed-task-1/tags',{ version: 1, tags: [] }],
  ]) assert.equal((await request(member, method, path, body)).status, 404, `${method} ${path}`);
  assert.equal((await request(member, 'POST', '/task-templates', { taskId: 'seed-task-1', name: '越权模板' })).status, 404);
  assert.equal((await request(member, 'POST', '/recurring-series', { taskId: 'seed-task-1' })).status, 404);
  const bulk = await request(member, 'POST', '/tasks/bulk', { ids: [own.id, 'seed-task-1'], versions: { [own.id]: own.version, 'seed-task-1': 1 }, action: 'delete' });
  assert.equal(bulk.status, 409);
  assert.equal((await request(member, 'GET', `/tasks/${own.id}`)).status, 200);
  assert.equal((await request(admin, 'GET', '/tasks/seed-task-1')).status, 200);
});
