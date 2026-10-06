import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/utils/categoryProgress.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { aggregateCategoryProgress, categorySegmentPercent } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const categories = [
  { category: '基础概念', count: 4, tasks: [{ status: 'done', phase: '基础' }, { status: 'in_progress', phase: '基础' }, { status: 'todo', phase: '进阶' }, { status: 'blocked', phase: '自定义阶段' }] },
  { category: '工程化', count: 2, tasks: [{ status: 'done', phase: '工程化' }, { status: 'done', phase: '基础' }] },
];
test('all four segments sum to the category task total', () => {
  const result = aggregateCategoryProgress(categories);
  assert.deepEqual(result, [
    { category: '基础概念', total: 4, counts: { done: 1, in_progress: 1, todo: 1, blocked: 1 } },
    { category: '工程化', total: 2, counts: { done: 2, in_progress: 0, todo: 0, blocked: 0 } },
  ]);
  for (const category of result) assert.equal(Object.values(category.counts).reduce((sum, n) => sum + n, 0), category.total);
});
test('phase filters both counts and percentage denominator, retaining custom phases', () => {
  const result = aggregateCategoryProgress(categories, '基础');
  assert.equal(result[0].total, 2);
  assert.equal(categorySegmentPercent(result[0].counts.done, result[0].total), 50);
  assert.deepEqual(aggregateCategoryProgress(categories, '自定义阶段'), [{ category: '基础概念', total: 1, counts: { done: 0, in_progress: 0, todo: 0, blocked: 1 } }]);
});
test('empty phases and empty data yield no columns; switching filters preserves input data', () => {
  const original = JSON.stringify(categories);
  assert.deepEqual(aggregateCategoryProgress(categories, '不存在'), []);
  assert.deepEqual(aggregateCategoryProgress([]), []);
  aggregateCategoryProgress(categories, '基础'); aggregateCategoryProgress(categories, '工程化');
  assert.equal(JSON.stringify(categories), original);
});
test('segment percentages handle zero, full and fractional counts', () => {
  assert.equal(categorySegmentPercent(0, 0), 0);
  assert.equal(categorySegmentPercent(0, 5), 0);
  assert.equal(categorySegmentPercent(5, 5), 100);
  assert.equal(categorySegmentPercent(1, 3), 33.3);
});
