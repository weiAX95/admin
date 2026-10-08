import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvaluationCases, referencedAssetIds } from '../mock/evaluation-datasets.mjs';

test('legacy and structured cases normalize without changing a stable key', () => {
  const [legacy, structured] = validateEvaluationCases([
    { caseKey: 'old', variables: { question: '你好' }, referenceAnswer: '您好' },
    { caseKey: 'media', input: { parts: [{ type: 'text', text: '描述图片' }, { type: 'image', assetId: 'asset-1' }] }, expectedOutput: { parts: [{ type: 'image', assetId: 'asset-2' }] }, context: [{ role: 'user', parts: [{ type: 'text', text: '之前的问题' }] }], tags: ['视觉'], difficulty: 3, source: 'qa_import' },
  ]);
  assert.equal(legacy.key, 'old');
  assert.equal(legacy.input.parts[0].text, '你好');
  assert.equal(legacy.referenceAnswer, '您好');
  assert.deepEqual([...referencedAssetIds([legacy, structured])].sort(), ['asset-1', 'asset-2']);
  assert.equal(structured.variables.question, '描述图片');
});

test('invalid and duplicate data is rejected, and 10k is the limit', () => {
  assert.throws(() => validateEvaluationCases([{ caseKey: 'x', input: 'ok' }, { caseKey: 'x', input: 'again' }]), /重复/);
  assert.throws(() => validateEvaluationCases([{ caseKey: 'x', input: { parts: [{ type: 'image', assetId: '' }] } }]), /附件/);
  assert.throws(() => validateEvaluationCases([{ caseKey: 'x', input: 'ok', difficulty: 6 }]), /难度/);
  assert.equal(validateEvaluationCases(Array.from({ length: 10000 }, (_, i) => ({ caseKey: `case-${i}`, input: 'x' }))).length, 10000);
  assert.throws(() => validateEvaluationCases(Array.from({ length: 10001 }, (_, i) => ({ caseKey: `case-${i}`, input: 'x' }))), /10,000/);
});
