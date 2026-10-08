// Metric results are normalized to [0, 1]; unavailable inputs stay null, never zero.
export const TOKENIZER_VERSION = 'intl-word-v1';
export const BUILT_IN_METRICS = Object.freeze(['exact', 'token_f1', 'bleu', 'rouge_l', 'tool_selection', 'parameter_accuracy', 'latency_p50', 'latency_p95', 'latency_p99', 'output_tokens']);

const segmenters = new Map();
function tokens(value) {
  const text = String(value ?? '').normalize('NFKC').toLocaleLowerCase();
  if (!segmenters.has('word')) segmenters.set('word', new Intl.Segmenter('und', { granularity: 'word' }));
  return [...segmenters.get('word').segment(text)].filter(item => item.isWordLike).map(item => item.segment);
}
function counts(items) {
  const result = new Map();
  for (const item of items) result.set(item, (result.get(item) || 0) + 1);
  return result;
}
function overlap(left, right) {
  const a = counts(left), b = counts(right);
  return [...a].reduce((sum, [key, n]) => sum + Math.min(n, b.get(key) || 0), 0);
}
function f1(actual, expected) {
  if (!actual.length && !expected.length) return 1;
  if (!actual.length || !expected.length) return 0;
  const common = overlap(actual, expected);
  return common ? 2 * common / (actual.length + expected.length) : 0;
}
function ngrams(items, n) { return Array.from({ length: Math.max(0, items.length - n + 1) }, (_, index) => JSON.stringify(items.slice(index, index + n))); }
function bleu(actual, expected) {
  if (!actual.length && !expected.length) return 1;
  if (!actual.length || !expected.length) return 0;
  const order = Math.min(4, actual.length, expected.length);
  let logSum = 0;
  for (let n = 1; n <= order; n++) {
    const a = ngrams(actual, n), b = ngrams(expected, n);
    // Unsmoothed modified precision: a missing n-gram makes BLEU zero.
    const match = overlap(a, b);
    if (!match) return 0;
    logSum += Math.log(match / a.length);
  }
  return Math.exp(logSum / order) * Math.exp(Math.min(0, 1 - expected.length / actual.length));
}
function rougeL(actual, expected) {
  if (!actual.length && !expected.length) return 1;
  if (!actual.length || !expected.length) return 0;
  let previous = new Uint32Array(expected.length + 1);
  for (const word of actual) {
    const current = new Uint32Array(expected.length + 1);
    for (let j = 1; j <= expected.length; j++) current[j] = word === expected[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    previous = current;
  }
  return 2 * previous[expected.length] / (actual.length + expected.length);
}
function equalJson(left, right) {
  if (typeof left !== typeof right || left === null || right === null) return left === right;
  if (typeof left !== 'object') return left === right;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, i) => equalJson(item, right[i]));
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}
function toolScore(kind, actualTools, expectedTools) {
  if (!Array.isArray(expectedTools)) return null;
  if (!Array.isArray(actualTools)) actualTools = [];
  if (!expectedTools.length) return actualTools.length ? 0 : 1;
  if (kind === 'tool_selection') return expectedTools.filter((tool, i) => actualTools[i]?.name === tool.name).length / Math.max(actualTools.length, expectedTools.length);
  const expected = expectedTools.flatMap((tool, i) => Object.entries(tool.arguments || {}).map(([key, value]) => ({ index: i, name: tool.name, key, value })));
  if (!expected.length) return expectedTools.every((tool, i) => equalJson(actualTools[i]?.arguments || {}, tool.arguments || {})) ? 1 : 0;
  return expected.filter(field => actualTools[field.index]?.name === field.name && equalJson(actualTools[field.index]?.arguments?.[field.key], field.value)).length / expected.length;
}

export function scoreBuiltIn(metric, { output, expectedOutput, actualTools, expectedTools }) {
  if (metric === 'tool_selection' || metric === 'parameter_accuracy') return toolScore(metric, actualTools, expectedTools);
  if (expectedOutput === undefined || expectedOutput === null || typeof expectedOutput !== 'string') return null;
  if (typeof output !== 'string') return null;
  if (metric === 'exact') return output.trim().normalize('NFKC').toLocaleLowerCase() === expectedOutput.trim().normalize('NFKC').toLocaleLowerCase() ? 1 : 0;
  const actual = tokens(output), expected = tokens(expectedOutput);
  if (metric === 'token_f1') return f1(actual, expected);
  if (metric === 'bleu') return bleu(actual, expected);
  if (metric === 'rouge_l') return rougeL(actual, expected);
  throw new Error(`未知内置指标：${metric}`);
}

export function summarizeEfficiency(rows) {
  const valid = rows.filter(row => Number.isFinite(row.latencyMs) && Number.isFinite(row.completionTokens));
  const latency = valid.map(row => row.latencyMs).sort((a, b) => a - b);
  const percentile = p => latency.length ? latency[Math.max(0, Math.ceil(p * latency.length) - 1)] : null;
  return { count: valid.length, p50LatencyMs: percentile(0.5), p95LatencyMs: percentile(0.95), p99LatencyMs: percentile(0.99), averageOutputTokens: valid.length ? valid.reduce((sum, row) => sum + row.completionTokens, 0) / valid.length : null };
}
