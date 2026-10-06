import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOverdueTasks } from '../mock/overdue.mjs';
const now = '2026-10-05T04:00:00Z';
const task = (id, dueDate, status = 'todo') => ({ id, title: id, dueDate, status });

test('only includes overdue unfinished tasks, excludes today, future, missing and invalid dates', () => {
  const tasks = [task('old', '2026-10-04'), task('today', '2026-10-05'), task('future', '2026-10-06'), task('done', '2026-09-01', 'done'), task('empty', ''), task('bad', 'invalid'), task('impossible', '2026-02-30')];
  assert.deepEqual(computeOverdueTasks(tasks, now).map(t => t.id), ['old']);
});
test('severity boundaries at 1, 3, 4, 7 and 8 days; sorts most overdue first', () => {
  const tasks = [task('1', '2026-10-04'), task('3', '2026-10-02'), task('4', '2026-10-01'), task('7', '2026-09-28'), task('8', '2026-09-27')];
  assert.deepEqual(computeOverdueTasks(tasks, now).map(t => [t.overdueDays, t.severity]), [[8, 'severe'], [7, 'moderate'], [4, 'moderate'], [3, 'warning'], [1, 'warning']]);
});
test('Shanghai midnight changes overdue days and timestamps normalize to Shanghai date', () => {
  const tasks = [task('midnight', '2026-10-05'), task('timestamp', '2026-10-03T17:00:00Z', 'blocked')];
  assert.deepEqual(computeOverdueTasks(tasks, '2026-10-05T16:00:00Z').map(t => [t.id, t.dueDate, t.overdueDays]), [['timestamp', '2026-10-04', 2], ['midnight', '2026-10-05', 1]]);
});
test('empty or completed-only sets produce no overdue tasks', () => {
  assert.deepEqual(computeOverdueTasks([], now), []);
  assert.deepEqual(computeOverdueTasks([task('done', '2020-01-01', 'done')], now), []);
});
