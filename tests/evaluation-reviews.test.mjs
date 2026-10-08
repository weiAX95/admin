import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewSummary, weightedKappa } from '../mock/evaluation-reviews.mjs';

test('quadratic weighted kappa is one for agreement and flags dimension gaps', () => {
  assert.equal(weightedKappa([[2, 2], [7, 7], [9, 9]]), 1);
  assert.equal(weightedKappa([]), null);
  assert.ok(weightedKappa([[0, 10], [10, 0]]) < 0);
  const scores = [
    { run_id: 'run-1', reviewer_id: 'a', role: 'primary', accuracy: 8, completeness: 7, brevity: 9, safety: 8 },
    { run_id: 'run-1', reviewer_id: 'b', role: 'primary', accuracy: 5, completeness: 7, brevity: 9, safety: 8 },
    { run_id: 'run-2', reviewer_id: 'a', role: 'primary', accuracy: 7, completeness: 8, brevity: 8, safety: 8 },
    { run_id: 'run-2', reviewer_id: 'b', role: 'primary', accuracy: 7, completeness: 8, brevity: 8, safety: 8 },
  ];
  const result = reviewSummary(scores);
  assert.deepEqual(result.disputes.map(item => item.runId), ['run-1']);
  assert.equal(result.reviewedPairs, 2);
  assert.equal(result.disputes[0].dimensions[0], 'accuracy');
});
