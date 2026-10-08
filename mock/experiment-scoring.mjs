import crypto from 'node:crypto';
import { scoreBuiltIn } from './evaluation-metrics.mjs';

export function ruleScore(output, reference, type) {
  if (reference === null || reference === undefined || !String(reference).trim()) return null;
  if (['exact','token_f1','bleu','rouge_l'].includes(type)) return Math.round(5000 * scoreBuiltIn(type, { output, expectedOutput: reference })) / 1000;
  return null;
}
export function combineScores(rule, judge) {
  if (typeof judge !== 'number' || !Number.isFinite(judge) || judge < 0 || judge > 5) return rule === null ? null : rule;
  return Math.round((rule === null ? judge : (rule + judge) / 2) * 1000) / 1000;
}
export function parseJudge(text) {
  const parsed = JSON.parse(String(text).trim());
  if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score) || parsed.score < 0 || parsed.score > 5) throw new Error('Judge 分数无效');
  return { score: parsed.score, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 2000) : '' };
}
export async function saveRunMetric(pool, runId, metricVersionId, rule, judge, reason, details = {}) {
  const combined = combineScores(rule, judge);
  const metric = (await pool.query('SELECT pass_threshold FROM experiment_metric_versions WHERE id=$1', [metricVersionId])).rows[0];
  if (!metric) throw new Error('指标版本不存在');
  await pool.query('INSERT INTO experiment_run_metrics(id,run_id,metric_version_id,rule_score,judge_score,combined_score,passed,reason,metric_details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(run_id,metric_version_id) DO UPDATE SET rule_score=EXCLUDED.rule_score,judge_score=EXCLUDED.judge_score,combined_score=EXCLUDED.combined_score,passed=EXCLUDED.passed,reason=EXCLUDED.reason,metric_details=EXCLUDED.metric_details', [crypto.randomUUID(), runId, metricVersionId, rule, judge, combined, combined === null ? null : combined >= metric.pass_threshold, reason, JSON.stringify(details)]);
  await pool.query('UPDATE experiment_runs SET auto_score=$2,score_reason=$3 WHERE id=$1', [runId, combined, reason]);
  return combined;
}
