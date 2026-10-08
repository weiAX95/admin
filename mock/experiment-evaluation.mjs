import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createBatch } from './experiment-platform.mjs';
import { promptMediaPath } from './prompt-media.mjs';
import { validateEvaluationCases, referencedAssetIds, caseInputFingerprint } from './evaluation-datasets.mjs';
import { BUILT_IN_METRICS, TOKENIZER_VERSION, summarizeEfficiency } from './evaluation-metrics.mjs';
import { rankModels, validateGoalRanges } from './evaluation-ranking.mjs';
import { judgeQuality } from './evaluation-judge-quality.mjs';
import { pythonMetricAvailable } from './evaluation-python-worker.mjs';
import { degradedRunMetrics } from './evaluation-regression.mjs';

const uuid = () => crypto.randomUUID();
const ok = (data, status = 200) => ({ status, data });
const fail = (error, status = 400) => ok({ error }, status);
const allowedTags = new Set(['幻觉','不完整','格式错误','推理错误','完美','偏题','冗余']);

const validatedCases = validateEvaluationCases;
async function validateAssets(client, datasetId, cases, actor) {
  const ids = [...referencedAssetIds(cases)];
  if (!ids.length) return;
  const settings = (await client.query('SELECT * FROM evaluation_settings WHERE id=1')).rows[0];
  const assets = (await client.query('SELECT id,kind,byte_size,uploaded_by FROM prompt_media_assets WHERE id=ANY($1::text[])', [ids])).rows;
  if (assets.length !== ids.length) throw new Error('部分媒体附件不存在');
  if (actor?.role !== 'admin' && assets.some(asset => asset.uploaded_by !== actor?.id)) throw new Error('无权引用其他账号的媒体附件');
  const newBytes = assets.reduce((sum, asset) => sum + Number(asset.byte_size), 0);
  if (newBytes > Number(settings.dataset_media_bytes)) throw new Error('单数据集媒体引用超过配额');
  const existing = (await client.query('SELECT DISTINCT a.asset_id,p.byte_size FROM evaluation_case_assets a JOIN prompt_media_assets p ON p.id=a.asset_id JOIN experiment_dataset_cases c ON c.id=a.case_id JOIN experiment_dataset_versions v ON v.id=c.dataset_version_id WHERE v.dataset_id=$1', [datasetId])).rows;
  const existingIds = new Set(existing.map(row => row.asset_id));
  if (existing.reduce((sum, row) => sum + Number(row.byte_size), 0) + assets.filter(asset => !existingIds.has(asset.id)).reduce((sum, asset) => sum + Number(asset.byte_size), 0) > Number(settings.dataset_media_bytes)) throw new Error('单数据集媒体配额不足');
  const global = (await client.query('SELECT DISTINCT a.asset_id,p.byte_size FROM evaluation_case_assets a JOIN prompt_media_assets p ON p.id=a.asset_id')).rows;
  const globalIds = new Set(global.map(row => row.asset_id));
  if (global.reduce((sum, row) => sum + Number(row.byte_size), 0) + assets.filter(asset => !globalIds.has(asset.id)).reduce((sum, asset) => sum + Number(asset.byte_size), 0) > Number(settings.global_media_bytes)) throw new Error('评测媒体总配额不足');
  const stat = await fs.statfs(promptMediaPath(ids[0]));
  const free = Number(stat.bavail) * Number(stat.bsize), total = Number(stat.blocks) * Number(stat.bsize);
  if (free < total * Number(settings.min_free_percent) / 100) throw new Error(`磁盘剩余空间不足 ${settings.min_free_percent}%`);
}

export async function insertVersion(client, datasetId, version, cases, actor) {
  const items = validatedCases(cases);
  await validateAssets(client, datasetId, items, actor);
  const id = uuid();
  await client.query('INSERT INTO experiment_dataset_versions(id,dataset_id,version) VALUES($1,$2,$3)', [id, datasetId, version]);
  for (let index = 0; index < items.length; index += 500) {
    const chunk = items.slice(index, index + 500);
    await client.query(`INSERT INTO experiment_dataset_cases(id,dataset_version_id,case_key,variables,reference_answer,difficulty,category,input_payload,expected_payload,context_payload,tags,difficulty_score,source,expected_tools)
      SELECT item.id,$2,item.key,item.variables,item.reference_answer,item.difficulty,item.category,item.input,item.expected,item.context,item.tags,item.difficulty_score,item.source,item.expected_tools
      FROM jsonb_to_recordset($1::jsonb) AS item(id text,key text,variables jsonb,reference_answer text,difficulty text,category text,input jsonb,expected jsonb,context jsonb,tags text[],difficulty_score smallint,source text,expected_tools jsonb)`, [JSON.stringify(chunk.map(item => ({ id: item.id, key: item.key, variables: item.variables, reference_answer: item.referenceAnswer, difficulty: item.difficulty, category: item.category, input: item.input, expected: item.expected, context: item.context, tags: item.tags, difficulty_score: item.difficultyScore, source: item.source, expected_tools: item.expectedTools }))), id]);
    const links = chunk.flatMap(item => [...referencedAssetIds([item])].map(assetId => ({ case_id: item.id, asset_id: assetId })));
    if (links.length) await client.query('INSERT INTO evaluation_case_assets(case_id,asset_id) SELECT case_id,asset_id FROM jsonb_to_recordset($1::jsonb) AS item(case_id text,asset_id text)', [JSON.stringify(links)]);
  }
  return { id, datasetId, version };
}

export async function syncEvaluationCandidate(client, { sourceType, annotationId, sourceEntityId, rating, input, expected, context = [], tags = [] }) {
  if (!['session','experiment'].includes(sourceType)) throw new Error('候选来源无效');
  const status = rating >= 4 ? 'pending' : 'ineligible';
  await client.query(`INSERT INTO evaluation_candidates(id,source_type,source_annotation_id,source_entity_id,rating,input_payload,expected_payload,context_payload,tags,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(source_type,source_annotation_id) DO UPDATE SET rating=EXCLUDED.rating,input_payload=EXCLUDED.input_payload,expected_payload=EXCLUDED.expected_payload,context_payload=EXCLUDED.context_payload,tags=EXCLUDED.tags,status=CASE WHEN evaluation_candidates.status='published' THEN 'published' WHEN EXCLUDED.rating<4 THEN 'ineligible' WHEN evaluation_candidates.status IN ('staged','rejected') THEN evaluation_candidates.status ELSE 'pending' END,updated_at=now()`,
  [uuid(),sourceType,annotationId,sourceEntityId,rating,JSON.stringify(input),JSON.stringify(expected),JSON.stringify(context),tags,status]);
}

const caseFromRow = row => ({ caseKey: row.case_key, variables: row.variables, input: row.input_payload, expectedOutput: row.expected_payload, context: row.context_payload, tags: row.tags, difficulty: row.difficulty_score ?? row.difficulty, category: row.category, source: row.source, expectedTools: row.expected_tools });

function summary(values) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const percentile = p => sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];
  return { min: sorted[0], q1: percentile(0.25), median: percentile(0.5), q3: percentile(0.75), max: sorted.at(-1), count: sorted.length };
}

export async function regressionReport(client, batchId) {
  const batch = (await client.query('SELECT * FROM experiment_batches WHERE id=$1 AND kind=$2', [batchId, 'regression'])).rows[0];
  if (!batch) return fail('回归批次不存在', 404);
  const metric = (await client.query('SELECT * FROM experiment_metric_versions WHERE id=$1', [batch.metric_version_id])).rows[0];
  const rows = (await client.query('SELECT r.id,r.case_id,r.variant_id,v.label AS variant_label,r.status,r.auto_score,r.latency_ms,r.completion_tokens,r.output,r.output_parts,r.request_messages,r.error,c.case_key,c.variables,c.input_payload,c.expected_payload,c.reference_answer,c.context_payload,c.difficulty,c.category,m.passed,m.rule_score,m.judge_score,m.metric_details FROM experiment_runs r JOIN experiment_dataset_cases c ON c.id=r.case_id JOIN experiment_variants v ON v.id=r.variant_id LEFT JOIN experiment_run_metrics m ON m.run_id=r.id AND m.metric_version_id=$2 WHERE r.batch_id=$1 ORDER BY c.case_key', [batch.id, batch.metric_version_id])).rows;
  const baseline = (await client.query('SELECT r.auto_score,r.status,r.latency_ms,r.completion_tokens,c.case_key,c.variables,c.input_payload,c.context_payload,c.difficulty,c.category,m.passed,m.metric_details FROM experiment_runs r JOIN experiment_dataset_cases c ON c.id=r.case_id LEFT JOIN experiment_run_metrics m ON m.run_id=r.id AND m.metric_version_id=$2 WHERE r.batch_id=$1', [batch.baseline_batch_id,batch.metric_version_id])).rows;
  const baselineByCase = new Map(baseline.map(item => [item.case_key, item]));
  const currentKeys = new Set(rows.map(row => row.case_key));
  const removed = baseline.filter(item => !currentKeys.has(item.case_key)).map(item => item.case_key);
  const compared = rows.map(row => {
    const prior = baselineByCase.get(row.case_key);
    const comparisonStatus = !prior ? 'added' : caseInputFingerprint(prior) !== caseInputFingerprint(row) ? 'input_changed' : prior.auto_score === null || prior.status !== 'completed' ? 'baseline_unscored' : 'comparable';
    const baselineScore = comparisonStatus === 'comparable' ? prior.auto_score : null;
    return { caseId: row.case_id, caseKey: row.case_key, variantId: row.variant_id, variantLabel: row.variant_label, score: row.auto_score, baselineScore, comparisonStatus, delta: row.auto_score === null || baselineScore === null ? null : Number((row.auto_score - baselineScore).toFixed(3)), passed: row.passed, status: row.status, difficulty: row.difficulty || '未分类', category: row.category || '未分类', ruleScore: row.rule_score, judgeScore: row.judge_score, metricDetails: row.metric_details, input: row.input_payload, context: row.context_payload, expectedOutput: row.expected_payload || row.reference_answer, requestMessages: row.request_messages, output: row.output, outputParts: row.output_parts, error: row.error };
  });
  const scored = compared.filter(item => item.score !== null && item.status === 'completed');
  const strata = field => {
    const groups = new Map(compared.map(item => [item[field], { name: item[field], count: 0, passed: 0, totalScore: 0 }]));
    for (const item of scored) { const group = groups.get(item[field]); group.count++; group.passed += item.passed ? 1 : 0; group.totalScore += item.score; }
    return [...groups.values()].map(group => ({ name: group.name, count: group.count, passRate: group.count ? group.passed / group.count : null, averageScore: group.count ? group.totalScore / group.count : null }));
  };
  const histogram = Array.from({ length: 5 }, (_, index) => ({ range: `${index}–${index + 1}`, count: scored.filter(item => item.score >= index && (index === 4 ? item.score <= 5 : item.score < index + 1)).length }));
  return ok({ batchId, status: batch.status, datasetVersionId: batch.dataset_version_id, baselineBatchId: batch.baseline_batch_id, metricVersionId: metric.id, passThreshold: metric.pass_threshold, regressionThreshold: metric.regression_threshold, normalizedRegressionThreshold:Number(metric.normalized_regression_threshold), total: compared.length, scored: scored.length, passRate: scored.length ? scored.filter(item => item.passed).length / scored.length : null, box: summary(scored.map(item => item.score)), histogram, efficiency: summarizeEfficiency(rows.map(row => ({ latencyMs: row.latency_ms, completionTokens: row.completion_tokens }))), statusDistribution: { passed: scored.filter(item => item.passed).length, belowThreshold: scored.filter(item => !item.passed).length, failed: compared.filter(item => item.status === 'failed').length, unscored: compared.filter(item => item.status === 'completed' && item.score === null).length }, degraded: compared.filter(item => item.delta !== null && item.delta < -metric.regression_threshold).sort((a,b) => a.delta - b.delta), degradedMetrics:degradedRunMetrics(rows,baseline,metric.goal_ranges,Number(metric.normalized_regression_threshold)), removedCaseKeys: removed, byDifficulty: strata('difficulty'), byCategory: strata('category'), cases: compared });
}

function titleSimilarity(left, right) {
  const grams = text => { const value = String(text || '').toLocaleLowerCase().replace(/\s+/g, ''); const result = new Set(); for (let i=0;i<value.length-1;i++) result.add(value.slice(i,i+2)); return result; };
  const a=grams(left),b=grams(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter(value => b.has(value)).length / (new Set([...a,...b]).size);
}

export async function handleExperimentEvaluation(context) {
  const { client } = context;
  await client.query('SAVEPOINT evaluation_request');
  try {
    const result = await handleExperimentEvaluationInner(context);
    await client.query('RELEASE SAVEPOINT evaluation_request');
    return result;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT evaluation_request');
    await client.query('RELEASE SAVEPOINT evaluation_request');
    return fail(error instanceof Error ? error.message : '评测操作失败');
  }
}

async function handleExperimentEvaluationInner({ pathname, method, client, me, readBody, url }) {
  if (pathname === '/api/evaluation/judge-quality' && method === 'GET') {
    if (me.role !== 'admin') return fail('仅管理员可查看 Judge 质量',403);
    const datasetVersionId = url.searchParams.get('datasetVersionId'), metricVersionId = url.searchParams.get('metricVersionId');
    if (!datasetVersionId || !metricVersionId) return fail('请选择数据集版本和指标版本');
    const rows = (await client.query(`SELECT r.id,m.judge_score,m.metric_details,avg(s.accuracy) AS accuracy,avg(s.completeness) AS completeness,avg(s.brevity) AS brevity,avg(s.safety) AS safety
      FROM experiment_runs r JOIN experiment_batches b ON b.id=r.batch_id JOIN experiment_run_metrics m ON m.run_id=r.id AND m.metric_version_id=b.metric_version_id JOIN evaluation_review_scores s ON s.run_id=r.id
      WHERE b.dataset_version_id=$1 AND b.metric_version_id=$2 AND m.judge_score IS NOT NULL GROUP BY r.id,m.judge_score,m.metric_details`, [datasetVersionId,metricVersionId])).rows;
    return ok(judgeQuality(rows.map(row => ({ judgeScore:Number(row.judge_score),judgeDimensions:row.metric_details?.judgeDimensions,human:{accuracy:Number(row.accuracy),completeness:Number(row.completeness),brevity:Number(row.brevity),safety:Number(row.safety)} }))));
  }
  if (pathname === '/api/evaluation/settings') {
    if (method === 'GET') return ok((await client.query('SELECT * FROM evaluation_settings WHERE id=1')).rows[0]);
    if (method === 'PUT') {
      if (me.role !== 'admin') return fail('仅管理员可配置评测配额',403);
      const body = await readBody();
      const global = body.globalMediaBytes, dataset = body.datasetMediaBytes, free = body.minFreePercent;
      if (!Number.isSafeInteger(global) || global <= 0 || !Number.isSafeInteger(dataset) || dataset <= 0 || dataset > global || typeof free !== 'number' || !Number.isFinite(free) || free < 0 || free >= 100) return fail('配额或磁盘保留比例无效');
      return ok((await client.query('UPDATE evaluation_settings SET global_media_bytes=$1,dataset_media_bytes=$2,min_free_percent=$3,updated_at=now() WHERE id=1 RETURNING *',[global,dataset,free])).rows[0]);
    }
  }
  if (pathname === '/api/evaluation/leaderboard' && method === 'GET') {
    const datasetVersionId = url.searchParams.get('datasetVersionId'), metricVersionId = url.searchParams.get('metricVersionId');
    if (!datasetVersionId || !metricVersionId) return fail('请选择固定数据集和指标版本');
    const metric = (await client.query('SELECT goal_ranges FROM experiment_metric_versions WHERE id=$1', [metricVersionId])).rows[0];
    if (!metric) return fail('指标版本不存在', 404);
    let weights;
    try { weights = JSON.parse(url.searchParams.get('weights') || '{"accuracy":0.4,"latency":0.3,"tokens":0.3}'); } catch { return fail('权重格式无效'); }
    const rows = (await client.query("SELECT r.model_id,r.api_model,r.auto_score,r.latency_ms,r.completion_tokens FROM experiment_runs r JOIN experiment_batches b ON b.id=r.batch_id WHERE b.dataset_version_id=$1 AND b.metric_version_id=$2 AND r.status='completed'", [datasetVersionId,metricVersionId])).rows;
    try { return ok({ datasetVersionId,metricVersionId,...rankModels(rows,metric.goal_ranges,weights) }); } catch (error) { return fail(error.message); }
  }
  if (pathname === '/api/evaluation/candidates' && method === 'GET') {
    if (me.role !== 'admin') return fail('仅管理员可审核候选池', 403);
    const status = url.searchParams.get('status') || 'pending';
    if (!['pending','staged','rejected','ineligible','published'].includes(status)) return fail('候选状态无效');
    const page = Math.max(1,Math.min(10000,Number(url.searchParams.get('page')) || 1));
    return ok({ items: (await client.query('SELECT * FROM evaluation_candidates WHERE status=$1 ORDER BY created_at DESC LIMIT 50 OFFSET $2', [status,(page-1)*50])).rows, page });
  }
  if (pathname === '/api/evaluation/candidates/publish' && method === 'POST') {
    if (me.role !== 'admin') return fail('仅管理员可发布候选用例', 403);
    const body = await readBody();
    const dataset = (await client.query('SELECT id FROM experiment_datasets WHERE id=$1 FOR UPDATE', [body.datasetId])).rows[0];
    if (!dataset) return fail('目标数据集不存在', 404);
    const staged = (await client.query("SELECT * FROM evaluation_candidates WHERE target_dataset_id=$1 AND status='staged' ORDER BY created_at FOR UPDATE", [dataset.id])).rows;
    if (!staged.length) return fail('没有待发布的候选用例', 409);
    const latest = (await client.query('SELECT * FROM experiment_dataset_versions WHERE dataset_id=$1 ORDER BY version DESC LIMIT 1', [dataset.id])).rows[0];
    const previous = latest ? (await client.query('SELECT * FROM experiment_dataset_cases WHERE dataset_version_id=$1 ORDER BY case_key', [latest.id])).rows.map(caseFromRow) : [];
    const added = staged.map(item => ({ caseKey: `candidate-${item.id}`, input: item.input_payload, expectedOutput: item.expected_payload, context: item.context_payload, tags: item.tags, difficulty: 3, source: item.source_type === 'session' ? 'session_extract' : 'qa_import' }));
    if (previous.length + added.length > 10000) return fail('发布后超过数据集 10,000 条上限', 409);
    const version = await insertVersion(client,dataset.id,latest ? latest.version + 1 : 1,[...previous,...added],me);
    await client.query("UPDATE evaluation_candidates SET status='published',published_version_id=$2,updated_at=now() WHERE id=ANY($1::text[])", [staged.map(item => item.id),version.id]);
    return ok({ versionId: version.id, published: staged.length }, 201);
  }
  const evaluationCandidateRoute = pathname.match(/^\/api\/evaluation\/candidates\/([^/]+)\/review$/);
  if (evaluationCandidateRoute && method === 'POST') {
    if (me.role !== 'admin') return fail('仅管理员可审核候选池', 403);
    const body = await readBody();
    if (!['staged','rejected'].includes(body.status)) return fail('审核状态无效');
    if (body.status === 'staged' && !(await client.query('SELECT 1 FROM experiment_datasets WHERE id=$1', [body.datasetId])).rowCount) return fail('目标数据集不存在', 404);
    const candidate = (await client.query("SELECT * FROM evaluation_candidates WHERE id=$1 AND status='pending' FOR UPDATE", [evaluationCandidateRoute[1]])).rows[0];
    if (!candidate) return fail('候选不存在或已审核', 409);
    const input = body.input === undefined ? candidate.input_payload : body.input;
    const expected = body.expectedOutput === undefined ? candidate.expected_payload : body.expectedOutput;
    try { validatedCases([{ caseKey: 'preview', input, expectedOutput: expected, context: candidate.context_payload, tags: candidate.tags, difficulty: 3 }]); } catch (error) { return fail(error.message); }
    await client.query('UPDATE evaluation_candidates SET status=$2,input_payload=$3,expected_payload=$4,target_dataset_id=$5,reviewed_by=$6,updated_at=now() WHERE id=$1', [candidate.id,body.status,JSON.stringify(input),JSON.stringify(expected),body.status === 'staged' ? body.datasetId : null,me.id]);
    return ok({ id: candidate.id, status: body.status });
  }
  if (pathname === '/api/evaluation/alerts' && method === 'GET') {
    if (me.role !== 'admin') return fail('仅管理员可查看退化告警', 403);
    return ok({ items: (await client.query('SELECT * FROM evaluation_alerts ORDER BY created_at DESC LIMIT 200')).rows });
  }
  if (pathname === '/api/evaluation/metrics' && method === 'GET') return ok({ tokenizerVersion: TOKENIZER_VERSION, builtIns: BUILT_IN_METRICS, pythonEnabled: await pythonMetricAvailable(), bertScoreEnabled: process.env.EVALUATION_BERTSCORE_ENABLED === 'true' && await pythonMetricAvailable('bertscore') });
  if (pathname === '/api/evaluation/metric-scripts') {
    if (method === 'GET') return ok({ items:(await client.query('SELECT id,name,created_by,created_at FROM evaluation_metric_scripts ORDER BY created_at DESC')).rows });
    if (method === 'POST') {
      if (me.role !== 'admin') return fail('仅管理员可登记 Python 指标',403);
      const body=await readBody();
      if (!String(body.name||'').trim() || String(body.name).length>120 || typeof body.source!=='string' || !body.source.trim() || body.source.length>20000) return fail('指标名称或 Python 源码无效');
      if (!(await pythonMetricAvailable())) return fail('隔离 Python 容器未就绪',409);
      const id=uuid();
      await client.query('INSERT INTO evaluation_metric_scripts(id,name,source,created_by) VALUES($1,$2,$3,$4)',[id,body.name.trim(),body.source,me.id]);
      return ok({id},201);
    }
  }
  if (pathname === '/api/evaluation/folders') {
    if (method === 'GET') return ok({ items: (await client.query('SELECT * FROM evaluation_folders ORDER BY name,id')).rows });
    if (method === 'POST') {
      const body = await readBody();
      if (!String(body.name || '').trim() || String(body.name).length > 120) return fail('文件夹名称须为 1–120 字');
      if (body.parentId && !(await client.query('SELECT 1 FROM evaluation_folders WHERE id=$1', [body.parentId])).rowCount) return fail('父文件夹不存在', 404);
      const id = uuid();
      await client.query('INSERT INTO evaluation_folders(id,name,parent_id,created_by) VALUES($1,$2,$3,$4)', [id, body.name.trim(), body.parentId || null, me.id]);
      return ok({ id }, 201);
    }
  }
  const folderRoute = pathname.match(/^\/api\/evaluation\/folders\/([^/]+)$/);
  if (folderRoute && me.role === 'admin') {
    if (method === 'PATCH') {
      const body = await readBody();
      if (!String(body.name || '').trim() || String(body.name).length > 120) return fail('文件夹名称须为 1–120 字');
      if (body.parentId) {
        const descendants = (await client.query('WITH RECURSIVE branch AS (SELECT id FROM evaluation_folders WHERE id=$1 UNION ALL SELECT f.id FROM evaluation_folders f JOIN branch b ON f.parent_id=b.id) SELECT id FROM branch', [folderRoute[1]])).rows;
        if (descendants.some(row => row.id === body.parentId)) return fail('文件夹不能移入自身或子文件夹');
      }
      const result = await client.query('UPDATE evaluation_folders SET name=$2,parent_id=$3 WHERE id=$1 RETURNING id', [folderRoute[1], body.name.trim(), body.parentId || null]);
      return result.rowCount ? ok(result.rows[0]) : fail('文件夹不存在', 404);
    }
    if (method === 'DELETE') {
      const result = await client.query('DELETE FROM evaluation_folders WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM evaluation_folders WHERE parent_id=$1) AND NOT EXISTS(SELECT 1 FROM experiment_datasets WHERE folder_id=$1) RETURNING id', [folderRoute[1]]);
      return result.rowCount ? ok({ deleted: true }) : fail('文件夹非空或不存在', 409);
    }
  }
  if (folderRoute) return fail('仅管理员可管理文件夹', 403);
  if (pathname === '/api/experiment-baselines' && method === 'GET') {
    const datasetVersionId = url.searchParams.get('datasetVersionId');
    const metricVersionId = url.searchParams.get('metricVersionId');
    if (!datasetVersionId || !metricVersionId) return fail('请选择数据集和指标版本');
    const rows = (await client.query("SELECT b.id,b.created_at,e.title AS experiment_title FROM experiment_batches b JOIN experiments e ON e.id=b.experiment_id JOIN experiment_dataset_versions selected ON selected.id=$1 JOIN experiment_dataset_versions source ON source.id=b.dataset_version_id WHERE source.dataset_id=selected.dataset_id AND b.metric_version_id=$2 AND b.status IN ('completed','partial') AND EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status='completed' AND r.auto_score IS NOT NULL) ORDER BY b.created_at DESC LIMIT 100", [datasetVersionId, metricVersionId])).rows;
    return ok({ items: rows });
  }
  if (pathname === '/api/experiment-metrics') {
    if (method === 'GET') return ok({ items: (await client.query('SELECT * FROM experiment_metric_versions ORDER BY name,version DESC')).rows });
    if (method === 'POST') {
      if (me.role !== 'admin') return fail('仅管理员可配置指标', 403);
      const body = await readBody();
      if (!body.name?.trim() || !['token_f1','exact','bleu','rouge_l','tool_selection','parameter_accuracy','bertscore','custom_python'].includes(body.ruleType) || typeof body.passThreshold !== 'number' || body.passThreshold < 0 || body.passThreshold > 5 || typeof body.regressionThreshold !== 'number' || body.regressionThreshold < 0 || body.regressionThreshold > 5 || !body.judgePrompt?.trim()) return fail('指标配置无效');
      if (body.ruleType === 'bertscore' && (process.env.EVALUATION_BERTSCORE_ENABLED !== 'true' || !(await pythonMetricAvailable('bertscore')))) return fail('BERTScore worker 尚未启用', 409);
      if (body.ruleType === 'custom_python' && (!(await pythonMetricAvailable()) || !(await client.query('SELECT 1 FROM evaluation_metric_scripts WHERE id=$1',[body.customScriptId])).rowCount)) return fail('隔离 Python 指标或容器不可用',409);
      const normalizedThreshold=body.normalizedRegressionThreshold===undefined?0.2:body.normalizedRegressionThreshold;
      if(typeof normalizedThreshold!=='number'||!Number.isFinite(normalizedThreshold)||normalizedThreshold<0||normalizedThreshold>1)return fail('归一化退化阈值须在 0–1 之间');
      let goalRanges;
      try { goalRanges = validateGoalRanges(body.goalRanges); } catch (error) { return fail(error.message); }
      const version = (await client.query('SELECT COALESCE(max(version),0)+1 AS next FROM experiment_metric_versions WHERE name=$1', [body.name.trim()])).rows[0].next;
      const id = uuid();
      await client.query('INSERT INTO experiment_metric_versions(id,name,version,rule_type,pass_threshold,regression_threshold,judge_prompt,tokenizer_version,goal_ranges,custom_script_id,normalized_regression_threshold) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id, body.name.trim(), version, body.ruleType, body.passThreshold, body.regressionThreshold, body.judgePrompt, TOKENIZER_VERSION,JSON.stringify(goalRanges),body.ruleType==='custom_python'?body.customScriptId:null,normalizedThreshold]);
      return ok({ id, version }, 201);
    }
  }
  if (pathname === '/api/experiment-datasets') {
    if (method === 'GET') return ok({ items: (await client.query('SELECT d.*,v.id AS latest_version_id,v.version AS latest_version FROM experiment_datasets d LEFT JOIN LATERAL (SELECT id,version FROM experiment_dataset_versions WHERE dataset_id=d.id ORDER BY version DESC LIMIT 1) v ON true ORDER BY d.created_at DESC')).rows });
    if (method === 'POST') {
      const body = await readBody();
      if (!body.name?.trim()) return fail('数据集名称为必填');
      try { validatedCases(body.cases); } catch (error) { return fail(error.message); }
      if (body.folderId && !(await client.query('SELECT 1 FROM evaluation_folders WHERE id=$1', [body.folderId])).rowCount) return fail('文件夹不存在', 404);
      const id = uuid();
      await client.query('INSERT INTO experiment_datasets(id,name,owner_id,folder_id,parent_version_id) VALUES($1,$2,$3,$4,$5)', [id, body.name.trim(), me.id, body.folderId || null, body.parentVersionId || null]);
      const version = await insertVersion(client, id, 1, body.cases,me);
      return ok({ id, name: body.name.trim(), version }, 201);
    }
  }
  const subsetRoute = pathname.match(/^\/api\/evaluation\/datasets\/([^/]+)\/subset$/);
  if (subsetRoute && method === 'POST') {
    const body = await readBody();
    const parent = (await client.query('SELECT v.*,d.owner_id FROM experiment_dataset_versions v JOIN experiment_datasets d ON d.id=v.dataset_id WHERE v.id=$1 AND v.dataset_id=$2', [body.versionId, subsetRoute[1]])).rows[0];
    if (!parent) return fail('源版本不存在', 404);
    if (me.role !== 'admin' && parent.owner_id !== me.id) return fail('无权创建子集', 403);
    if (!Array.isArray(body.caseKeys) || !body.caseKeys.length || body.caseKeys.length > 10000 || !String(body.name || '').trim()) return fail('请选择用例及子集名称');
    const cases = (await client.query('SELECT * FROM experiment_dataset_cases WHERE dataset_version_id=$1 AND case_key=ANY($2::text[])', [parent.id, body.caseKeys])).rows;
    if (cases.length !== new Set(body.caseKeys).size) return fail('部分用例不在源版本内');
    const id = uuid();
    await client.query('INSERT INTO experiment_datasets(id,name,owner_id,folder_id,parent_version_id) VALUES($1,$2,$3,$4,$5)', [id, body.name.trim(), me.id, body.folderId || null, parent.id]);
    const version = await insertVersion(client, id, 1, cases.map(caseFromRow),me);
    return ok({ id, version }, 201);
  }
  const datasetRoute = pathname.match(/^\/api\/experiment-datasets\/([^/]+)\/versions$/);
  if (datasetRoute) {
    const dataset = (await client.query('SELECT * FROM experiment_datasets WHERE id=$1', [datasetRoute[1]])).rows[0];
    if (!dataset) return fail('数据集不存在', 404);
    if (method === 'GET') return ok({ items: (await client.query('SELECT * FROM experiment_dataset_versions WHERE dataset_id=$1 ORDER BY version DESC', [dataset.id])).rows });
    if (method === 'POST') {
      if (me.role !== 'admin' && dataset.owner_id !== me.id) return fail('无权修改数据集', 403);
      const body = await readBody();
      try { validatedCases(body.cases); } catch (error) { return fail(error.message); }
      const version = (await client.query('SELECT COALESCE(max(version),0)+1 AS next FROM experiment_dataset_versions WHERE dataset_id=$1', [dataset.id])).rows[0].next;
      return ok(await insertVersion(client, dataset.id, version, body.cases,me), 201);
    }
  }
  const versionRoute = pathname.match(/^\/api\/experiment-dataset-versions\/([^/]+)$/);
  if (versionRoute && method === 'GET') {
    const version = (await client.query('SELECT * FROM experiment_dataset_versions WHERE id=$1', [versionRoute[1]])).rows[0];
    if (!version) return fail('版本不存在', 404);
    const cases = (await client.query('SELECT id,case_key,variables,reference_answer,difficulty,category,input_payload,expected_payload,context_payload,tags,difficulty_score,source,expected_tools FROM experiment_dataset_cases WHERE dataset_version_id=$1 ORDER BY case_key', [version.id])).rows;
    return ok({ ...version, cases });
  }
  const datasetRunRoute = pathname.match(/^\/api\/experiment-definitions\/([^/]+)\/(dataset-run|regression)$/);
  if (datasetRunRoute && method === 'POST') return createBatch(client, datasetRunRoute[1], me, await readBody(), datasetRunRoute[2] === 'regression' ? 'regression' : 'dataset');
  const reportRoute = pathname.match(/^\/api\/experiment-batches\/([^/]+)\/report$/);
  if (reportRoute && method === 'GET') return regressionReport(client, reportRoute[1]);
  const annotationRoute = pathname.match(/^\/api\/experiment-runs\/([^/]+)\/annotation$/);
  if (annotationRoute) {
    const run = (await client.query('SELECT id,experiment_id,status,user_prompt,output,output_parts,request_messages FROM experiment_runs WHERE id=$1', [annotationRoute[1]])).rows[0];
    if (!run) return fail('运行不存在', 404);
    if (method === 'GET') {
      const items = (await client.query('SELECT a.id,a.rating,a.reviewer_id,a.updated_at,array_remove(array_agg(t.tag),NULL) AS tags FROM experiment_annotations a LEFT JOIN experiment_annotation_tags t ON t.annotation_id=a.id WHERE a.run_id=$1 GROUP BY a.id', [run.id])).rows;
      const tags = new Map(); for (const item of items) for (const tag of item.tags) tags.set(tag,(tags.get(tag)||0)+1);
      const mine = items.find(item => item.reviewer_id === me.id);
      return ok({ mine: mine ? { rating: mine.rating, tags: mine.tags } : null, summary: { averageRating: items.length ? Math.round(items.reduce((sum,item)=>sum+item.rating,0)/items.length*10)/10 : null, ratingCount: items.length, tags: [...tags].map(([tag,count])=>({ tag,count })) } });
    }
    if (method === 'POST') {
      const body = await readBody();
      if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5 || !Array.isArray(body.tags) || body.tags.some(tag => !allowedTags.has(tag))) return fail('评分需为 1–5，标签须在七种指定值内');
      const id = uuid();
      const result = await client.query('INSERT INTO experiment_annotations(id,experiment_id,run_id,reviewer_id,rating) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id,reviewer_id) WHERE reviewer_id IS NOT NULL DO UPDATE SET rating=EXCLUDED.rating,updated_at=now() RETURNING id', [id, run.experiment_id, run.id, me.id, body.rating]);
      const annotationId = result.rows[0].id;
      await client.query('DELETE FROM experiment_annotation_tags WHERE annotation_id=$1', [annotationId]);
      for (const tag of new Set(body.tags)) await client.query('INSERT INTO experiment_annotation_tags(annotation_id,tag) VALUES($1,$2)', [annotationId, tag]);
      await client.query('INSERT INTO experiment_dataset_candidates(id,experiment_id,run_id,annotation_id) VALUES($1,$2,$3,$4) ON CONFLICT(annotation_id) DO UPDATE SET status=$5', [uuid(), run.experiment_id, run.id, annotationId, 'pending']);
      if (run.status === 'completed') {
        const messages = Array.isArray(run.request_messages) ? run.request_messages : [];
        const lastUser = messages.findLastIndex(item => item.role === 'user');
        const input = lastUser >= 0 ? messages[lastUser].parts || messages[lastUser].content || run.user_prompt : run.user_prompt;
        const expected = Array.isArray(run.output_parts) && run.output_parts.length ? { parts: run.output_parts.map(part => part.type === 'text' ? { type: 'text', text: part.text } : { type: part.type, assetId: part.assetId }) } : run.output || '';
        await syncEvaluationCandidate(client,{ sourceType:'experiment',annotationId,sourceEntityId:run.id,rating:body.rating,input:typeof input === 'string' ? input : { parts: input },expected,context:messages.slice(0,Math.max(0,lastUser)).map(item => ({ role:item.role,parts:item.parts || [{ type:'text',text:item.content || '' }] })),tags:body.tags });
      }
      const items = (await client.query('SELECT rating FROM experiment_annotations WHERE run_id=$1', [run.id])).rows;
      return ok({ rating: body.rating, tags: [...new Set(body.tags)], averageRating: Math.round(items.reduce((sum,item)=>sum+item.rating,0)/items.length*10)/10, ratingCount: items.length });
    }
  }
  if (pathname === '/api/experiment-candidates' && method === 'GET') {
    if (me.role !== 'admin') return fail('仅管理员可审核候选池', 403);
    return ok({ items: (await client.query('SELECT c.*,a.rating,r.output,e.title FROM experiment_dataset_candidates c JOIN experiment_annotations a ON a.id=c.annotation_id JOIN experiment_runs r ON r.id=c.run_id JOIN experiments e ON e.id=c.experiment_id ORDER BY c.created_at DESC LIMIT 200')).rows });
  }
  const candidateRoute = pathname.match(/^\/api\/experiment-candidates\/([^/]+)$/);
  if (candidateRoute && method === 'PATCH') {
    if (me.role !== 'admin') return fail('仅管理员可审核候选池', 403);
    const body = await readBody();
    if (!['accepted','rejected'].includes(body.status)) return fail('状态无效');
    const result = await client.query('UPDATE experiment_dataset_candidates SET status=$2 WHERE id=$1 RETURNING id', [candidateRoute[1], body.status]);
    return result.rowCount ? ok({ id: candidateRoute[1], status: body.status }) : fail('候选不存在', 404);
  }
  const chainSuggest = pathname.match(/^\/api\/experiments\/([^/]+)\/chain-suggestions$/);
  if (chainSuggest && method === 'GET') {
    const target = (await client.query('SELECT * FROM experiments WHERE id=$1', [chainSuggest[1]])).rows[0];
    if (!target) return fail('实验不存在', 404);
    const items = (await client.query('SELECT id,title,task_id,chain_id FROM experiments WHERE id<>$1 AND task_id IS NOT DISTINCT FROM $2', [target.id,target.task_id])).rows.map(item => ({ ...item, similarity: titleSimilarity(target.title,item.title) })).filter(item => item.similarity >= 0.6).sort((a,b)=>b.similarity-a.similarity);
    return ok({ items });
  }
  const chainConfirm = pathname.match(/^\/api\/experiments\/([^/]+)\/chain$/);
  if (chainConfirm && method === 'POST') {
    const target = (await client.query('SELECT * FROM experiments WHERE id=$1', [chainConfirm[1]])).rows[0];
    if (!target) return fail('实验不存在', 404);
    if (me.role !== 'admin' && target.owner_id !== me.id) return fail('无权加入版本链', 403);
    const body = await readBody();
    const peer = (await client.query('SELECT * FROM experiments WHERE id=$1', [body.peerId])).rows[0];
    if (!peer || (me.role !== 'admin' && peer.owner_id !== me.id)) return fail('目标实验不存在或无权管理', 404);
    if (peer.task_id !== target.task_id) return fail('版本链任务必须一致');
    const chainId = peer.chain_id || target.chain_id || uuid();
    if (!peer.chain_id && !target.chain_id) await client.query('INSERT INTO experiment_chains(id,title,task_id,created_by) VALUES($1,$2,$3,$4)', [chainId, target.title, target.task_id, me.id]);
    await client.query('UPDATE experiments SET chain_id=$1 WHERE id=ANY($2::text[])', [chainId, [target.id, peer.id]]);
    return ok({ chainId });
  }
  const chainRoute = pathname.match(/^\/api\/experiment-chains\/([^/]+)$/);
  if (chainRoute && method === 'GET') {
    const chain = (await client.query('SELECT * FROM experiment_chains WHERE id=$1', [chainRoute[1]])).rows[0];
    if (!chain) return fail('版本链不存在', 404);
    const items = (await client.query('SELECT e.id,e.title,e.created_at,avg(r.auto_score) AS score,avg(r.latency_ms) AS latency_ms,sum(r.cost_usd) AS cost_usd FROM experiments e LEFT JOIN experiment_runs r ON r.experiment_id=e.id AND r.status=$2 WHERE e.chain_id=$1 GROUP BY e.id ORDER BY e.created_at', [chain.id, 'completed'])).rows;
    return ok({ id: chain.id, title: chain.title, items });
  }
  if (pathname === '/api/experiment-costs' && method === 'GET') {
    const total = (await client.query("SELECT COALESCE(sum(cost_usd),0) AS total FROM experiment_runs WHERE status='completed' AND date_trunc('month',created_at AT TIME ZONE 'Asia/Shanghai')=date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai')")).rows[0].total;
    const byModel = (await client.query("SELECT api_model,sum(cost_usd) AS cost FROM experiment_runs WHERE status='completed' AND date_trunc('month',created_at AT TIME ZONE 'Asia/Shanghai')=date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') GROUP BY api_model ORDER BY cost DESC")).rows;
    const top = (await client.query("SELECT e.id,e.title,sum(r.cost_usd) AS cost FROM experiment_runs r JOIN experiments e ON e.id=r.experiment_id WHERE r.status='completed' GROUP BY e.id ORDER BY cost DESC LIMIT 10")).rows;
    return ok({ monthTotalUsd: total, byModel, top });
  }
  return null;
}
