import test from 'node:test';
import assert from 'node:assert/strict';
import { quickActionCounts, quickPreview } from '../mock/quick-actions.mjs';
const db = {
  tasks: Array.from({ length: 5 }, (_, n) => ({ id: `t${n}`, title: `任务${n}`, createdAt: `2026-10-0${n + 1}T00:00:00Z`, updatedAt: '2026-10-10T00:00:00Z', description: 'large private body' })),
  sessions: [{ id: 's1', updatedAt: '2026-10-03T00:00:00Z', messages: [{ role: 'user', content: '了解 React' }, { role: 'assistant', content: '内容' }] }],
  notes: [{ id: 'n1', title: '笔记一', updatedAt: '2026-10-04T00:00:00Z', content: 'private note' }],
};
test('counts use metadata only and preview returns at most three lightweight newest items', () => {
  assert.deepEqual(quickActionCounts(db), { tasks: 5, sessions: 1, notes: 1 });
  assert.deepEqual(quickPreview(db, 'tasks').items.map(item => item.id), ['t4', 't3', 't2']);
  assert.deepEqual(quickPreview(db, 'sessions').items, [{ id: 's1', title: '了解 React' }]);
  assert.deepEqual(quickPreview(db, 'notes').items, [{ id: 'n1', title: '笔记一' }]);
  assert.ok(!('description' in quickPreview(db, 'tasks').items[0]));
  assert.ok(!('content' in quickPreview(db, 'notes').items[0]));
  assert.equal(db.tasks.length, 5);
});
test('empty lists and unknown preview types are explicit', () => {
  assert.deepEqual(quickActionCounts({ tasks: [], sessions: [], notes: [] }), { tasks: 0, sessions: 0, notes: 0 });
  assert.deepEqual(quickPreview({ tasks: [], sessions: [], notes: [] }, 'tasks'), { items: [] });
  assert.throws(() => quickPreview(db, 'experiments'), /预览类型/);
});
