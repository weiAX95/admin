import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreBuiltIn, summarizeEfficiency, TOKENIZER_VERSION } from '../mock/evaluation-metrics.mjs';

test('text metrics are bounded and Chinese/English tokens are stable', () => {
  assert.equal(TOKENIZER_VERSION, 'intl-word-v1');
  assert.equal(scoreBuiltIn('exact', { output: '你好 world', expectedOutput: '你好 world' }), 1);
  assert.equal(scoreBuiltIn('exact', { output: '你好', expectedOutput: '再见' }), 0);
  for (const metric of ['token_f1', 'bleu', 'rouge_l']) {
    assert.equal(scoreBuiltIn(metric, { output: '你好 world', expectedOutput: '你好 world' }), 1);
    const partial = scoreBuiltIn(metric, { output: '你好 world', expectedOutput: '你好 friend' });
    assert.ok(partial >= 0 && partial < 1, `${metric}: ${partial}`);
  }
  assert.equal(scoreBuiltIn('token_f1', { output: '', expectedOutput: '' }), 1);
  assert.equal(scoreBuiltIn('exact', { output: 'text' }), null);
});

test('tool metrics compare names, types, arrays and unordered object keys', () => {
  const expectedTools = [{ name: 'search', arguments: { query: 'A', limit: 2, flags: [true, false] } }];
  const actualTools = [{ name: 'search', arguments: { flags: [true, false], limit: 2, query: 'A' } }];
  assert.equal(scoreBuiltIn('tool_selection', { actualTools, expectedTools }), 1);
  assert.equal(scoreBuiltIn('parameter_accuracy', { actualTools, expectedTools }), 1);
  assert.equal(scoreBuiltIn('parameter_accuracy', { actualTools: [{ name: 'search', arguments: { flags: [false, true], limit: '2', query: 'A' } }], expectedTools }), 1 / 3);
  assert.equal(scoreBuiltIn('tool_selection', { actualTools: [], expectedTools }), 0);
});

test('efficiency summary uses nearest-rank latency and average tokens', () => {
  assert.deepEqual(summarizeEfficiency([{ latencyMs: 100, completionTokens: 10 }, { latencyMs: 200, completionTokens: 20 }, { latencyMs: 300, completionTokens: 30 }]), { count: 3, p50LatencyMs: 200, p95LatencyMs: 300, p99LatencyMs: 300, averageOutputTokens: 20 });
});
