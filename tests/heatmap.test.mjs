import test from 'node:test';
import assert from 'node:assert/strict';
import { activityHeatmap, activityDay } from '../mock/heatmap.mjs';
const activity = [
  { id: 'a', at: '2026-09-30T16:30:00Z', type: 'create', title: '新建' },
  { id: 'b', at: '2026-10-01T00:00:00Z', type: 'complete', title: '完成' },
  { id: 'c', at: '2026-10-01T03:00:00Z', type: 'note', title: '笔记' },
];
test('heatmap counts activities by Shanghai date and fills empty days', () => {
  assert.deepEqual(activityHeatmap(activity, '2026-09-30', '2026-10-03'), [
    { date: '2026-09-30', count: 0 }, { date: '2026-10-01', count: 3 },
    { date: '2026-10-02', count: 0 }, { date: '2026-10-03', count: 0 },
  ]);
});
test('day detail splits creates and completions and retains all activity', () => {
  const result = activityDay(activity, '2026-10-01');
  assert.equal(result.created, 1);
  assert.equal(result.completed, 1);
  assert.deepEqual(result.items.map(item => item.id), ['c', 'b', 'a']);
  assert.deepEqual(activityDay(activity, '2026-10-02').items, []);
});
test('invalid and excessive ranges are rejected', () => {
  assert.throws(() => activityHeatmap(activity, '2026-02-30', '2026-03-01'), /无效/);
  assert.throws(() => activityHeatmap(activity, '2026-10-05', '2026-10-04'), /无效/);
  assert.throws(() => activityHeatmap(activity, '2025-01-01', '2026-12-31'), /366/);
  assert.throws(() => activityDay(activity, '2026-13-01'), /无效/);
});
