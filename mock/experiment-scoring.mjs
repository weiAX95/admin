import crypto from 'node:crypto';

const clean = text => String(text || '').trim().toLocaleLowerCase();
function words(text) {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  return [...segmenter.segment(clean(text))].filter(item => item.isWordLike).map(item => item.segment);
}
export function ruleScore(output, reference, type) {
  if (reference === null || reference === undefined || !String(reference).trim()) return null;
  if (type === 'exact') return clean(output) === clean(reference) ? 5 : 0;
  const expected = words(reference), actual = words(output);
  if (!expected.length || !actual.length) return 0;
  const counts = new Map();
  for (const word of expected) counts.set(word, (counts.get(word) || 0) + 1);
  let overlap = 0;
  for (const word of actual) { const count = counts.get(word) || 0; if (count) { overlap++; counts.set(word, count - 1); } }
  const precision = overlap / actual.length, recall = overlap / expected.length;
  return precision + recall ? Math.round(5 * 2 * precision * recall / (precision + recall) * 1000) / 1000 : 0;
}
export function combineScores(rule, judge) {
  if (typeof judge !== 'number' || !Number.isFinite(judge) || judge < 0 || judge > 5) return null;
  return Math.round((rule === null ? judge : (rule + judge) / 2) * 1000) / 1000;
}
export function parseJudge(text) {
  const parsed = JSON.parse(String(text).trim());
  if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score) || parsed.score < 0 || parsed.score > 5) throw new Error('Judge 分数无效');
  return { score: parsed.score, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 2000) : '' };
}
export async function saveRunMetric(pool, runId, metricVersionId, rule, judge, reason) {
  const combined = combineScores(rule, judge);
  const metric = (await pool.query('SELECT pass_threshold FROM experiment_metric_versions WHERE id=$1', [metricVersionId])).rows[0];
  if (!metric) throw new Error('指标版本不存在');
  await pool.query('INSERT INTO experiment_run_metrics(id,run_id,metric_version_id,rule_score,judge_score,combined_score,passed,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(run_id,metric_version_id) DO UPDATE SET rule_score=EXCLUDED.rule_score,judge_score=EXCLUDED.judge_score,combined_score=EXCLUDED.combined_score,passed=EXCLUDED.passed,reason=EXCLUDED.reason', [crypto.randomUUID(), runId, metricVersionId, rule, judge, combined, combined === null ? null : combined >= metric.pass_threshold, reason]);
  await pool.query('UPDATE experiment_runs SET auto_score=$2,score_reason=$3 WHERE id=$1', [runId, combined, reason]);
  return combined;
}
