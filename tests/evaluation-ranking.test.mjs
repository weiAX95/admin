import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankModels } from '../mock/evaluation-ranking.mjs';

test('fixed metric goals and weights determine leaderboard without batch minmax', () => {
  const ranges = { accuracy: { min: 0, max: 5, higher: true }, latency: { min: 0, max: 1000, higher: false }, tokens: { min: 0, max: 100, higher: false } };
  const rows = [
    { model_id: 'a', api_model: 'A', auto_score: 4, latency_ms: 800, completion_tokens: 80 },
    { model_id: 'b', api_model: 'B', auto_score: 3, latency_ms: 100, completion_tokens: 10 },
    { model_id: 'b', api_model: 'B', auto_score: 3, latency_ms: 100, completion_tokens: 10 },
  ];
  assert.deepEqual(rankModels(rows, ranges, { accuracy: 1, latency: 0, tokens: 0 }).items.map(item => item.modelId), ['a', 'b']);
  assert.deepEqual(rankModels(rows, ranges, { accuracy: 0, latency: 1, tokens: 0 }).items.map(item => item.modelId), ['b', 'a']);
  assert.equal(rankModels([...rows, { model_id: 'a', api_model: 'A', auto_score: null, latency_ms: 100, completion_tokens: 10 }], ranges, { accuracy: 1, latency: 0, tokens: 0 }).excluded, 1);
});
