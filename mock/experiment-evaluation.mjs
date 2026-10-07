import crypto from 'node:crypto';
import { createBatch } from './experiment-platform.mjs';

const uuid = () => crypto.randomUUID();
const ok = (data, status = 200) => ({ status, data });
const fail = (error, status = 400) => ok({ error }, status);
const allowedTags = new Set(['幻觉','不完整','格式错误','推理错误','完美','偏题','冗余']);

function validatedCases(cases) {
  if (!Array.isArray(cases) || !cases.length || cases.length > 500) throw new Error('数据集版本须含 1–500 条用例');
  const keys = new Set();
  return cases.map((item, index) => {
    const key = String(item.caseKey || '').trim();
    if (!key || keys.has(key)) throw new Error(`第 ${index + 1} 条用例 ID 缺失或重复`);
    keys.add(key);
    if (!item.variables || typeof item.variables !== 'object' || Array.isArray(item.variables) || Object.values(item.variables).some(value => typeof value !== 'string')) throw new Error(`第 ${index + 1} 条变量必须是字符串映射`);
    return { id: uuid(), key, variables: item.variables, referenceAnswer: typeof item.referenceAnswer === 'string' ? item.referenceAnswer : null, difficulty: item.difficulty ? String(item.difficulty).slice(0, 50) : null, category: item.category ? String(item.category).slice(0, 50) : null };
  });
}

async function insertVersion(client, datasetId, version, cases) {
  const id = uuid();
  await client.query('INSERT INTO experiment_dataset_versions(id,dataset_id,version) VALUES($1,$2,$3)', [id, datasetId, version]);
  for (const item of validatedCases(cases)) await client.query('INSERT INTO experiment_dataset_cases(id,dataset_version_id,case_key,variables,reference_answer,difficulty,category) VALUES($1,$2,$3,$4,$5,$6,$7)', [item.id, id, item.key, JSON.stringify(item.variables), item.referenceAnswer, item.difficulty, item.category]);
  return { id, datasetId, version };
}

function summary(values) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const percentile = p => sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];
  return { min: sorted[0], q1: percentile(0.25), median: percentile(0.5), q3: percentile(0.75), max: sorted.at(-1), count: sorted.length };
}

async function regressionReport(client, batchId) {
  const batch = (await client.query('SELECT * FROM experiment_batches WHERE id=$1 AND kind=$2', [batchId, 'regression'])).rows[0];
  if (!batch) return fail('回归批次不存在', 404);
  const metric = (await client.query('SELECT * FROM experiment_metric_versions WHERE id=$1', [batch.metric_version_id])).rows[0];
  const rows = (await client.query('SELECT r.id,r.case_id,r.variant_id,r.status,r.auto_score,c.case_key,c.difficulty,c.category,m.passed,m.rule_score,m.judge_score FROM experiment_runs r JOIN experiment_dataset_cases c ON c.id=r.case_id LEFT JOIN experiment_run_metrics m ON m.run_id=r.id AND m.metric_version_id=$2 WHERE r.batch_id=$1 ORDER BY c.case_key', [batch.id, batch.metric_version_id])).rows;
  const baseline = (await client.query('SELECT case_id,auto_score FROM experiment_runs WHERE batch_id=$1', [batch.baseline_batch_id])).rows;
  const baselineByCase = new Map(baseline.map(item => [item.case_id, item.auto_score]));
  const compared = rows.map(row => ({ caseId: row.case_id, caseKey: row.case_key, variantId: row.variant_id, score: row.auto_score, baselineScore: baselineByCase.get(row.case_id), delta: row.auto_score === null ? null : Number((row.auto_score - baselineByCase.get(row.case_id)).toFixed(3)), passed: row.passed, status: row.status, difficulty: row.difficulty || '未分类', category: row.category || '未分类', ruleScore: row.rule_score, judgeScore: row.judge_score }));
  const scored = compared.filter(item => item.score !== null && item.status === 'completed');
  const strata = field => [...new Set(compared.map(item => item[field]))].map(value => { const group = scored.filter(item => item[field] === value); return { name: value, count: group.length, passRate: group.length ? group.filter(item => item.passed).length / group.length : null, averageScore: group.length ? group.reduce((sum,item) => sum + item.score,0)/group.length : null }; });
  return ok({ batchId, status: batch.status, datasetVersionId: batch.dataset_version_id, baselineBatchId: batch.baseline_batch_id, metricVersionId: metric.id, passThreshold: metric.pass_threshold, regressionThreshold: metric.regression_threshold, total: compared.length, scored: scored.length, passRate: scored.length ? scored.filter(item => item.passed).length / scored.length : null, box: summary(scored.map(item => item.score)), degraded: compared.filter(item => item.delta !== null && item.delta < -metric.regression_threshold), byDifficulty: strata('difficulty'), byCategory: strata('category'), cases: compared });
}

function titleSimilarity(left, right) {
  const grams = text => { const value = String(text || '').toLocaleLowerCase().replace(/\s+/g, ''); const result = new Set(); for (let i=0;i<value.length-1;i++) result.add(value.slice(i,i+2)); return result; };
  const a=grams(left),b=grams(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter(value => b.has(value)).length / (new Set([...a,...b]).size);
}

export async function handleExperimentEvaluation({ pathname, method, client, me, readBody, url }) {
  if (pathname === '/api/experiment-baselines' && method === 'GET') {
    const datasetVersionId = url.searchParams.get('datasetVersionId');
    const metricVersionId = url.searchParams.get('metricVersionId');
    if (!datasetVersionId || !metricVersionId) return fail('请选择数据集和指标版本');
    const rows = (await client.query("SELECT b.id,b.created_at,e.title AS experiment_title FROM experiment_batches b JOIN experiments e ON e.id=b.experiment_id WHERE b.dataset_version_id=$1 AND b.metric_version_id=$2 AND b.status='completed' AND (SELECT count(*) FROM experiment_runs r WHERE r.batch_id=b.id)=(SELECT count(*) FROM experiment_dataset_cases c WHERE c.dataset_version_id=$1) AND NOT EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND (r.status<>'completed' OR r.auto_score IS NULL)) ORDER BY b.created_at DESC LIMIT 100", [datasetVersionId, metricVersionId])).rows;
    return ok({ items: rows });
  }
  if (pathname === '/api/experiment-metrics') {
    if (method === 'GET') return ok({ items: (await client.query('SELECT * FROM experiment_metric_versions ORDER BY name,version DESC')).rows });
    if (method === 'POST') {
      if (me.role !== 'admin') return fail('仅管理员可配置指标', 403);
      const body = await readBody();
      if (!body.name?.trim() || !['token_f1','exact'].includes(body.ruleType) || typeof body.passThreshold !== 'number' || body.passThreshold < 0 || body.passThreshold > 5 || typeof body.regressionThreshold !== 'number' || body.regressionThreshold < 0 || body.regressionThreshold > 5 || !body.judgePrompt?.trim()) return fail('指标配置无效');
      const version = (await client.query('SELECT COALESCE(max(version),0)+1 AS next FROM experiment_metric_versions WHERE name=$1', [body.name.trim()])).rows[0].next;
      const id = uuid();
      await client.query('INSERT INTO experiment_metric_versions(id,name,version,rule_type,pass_threshold,regression_threshold,judge_prompt) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, body.name.trim(), version, body.ruleType, body.passThreshold, body.regressionThreshold, body.judgePrompt]);
      return ok({ id, version }, 201);
    }
  }
  if (pathname === '/api/experiment-datasets') {
    if (method === 'GET') return ok({ items: (await client.query('SELECT d.*,v.id AS latest_version_id,v.version AS latest_version FROM experiment_datasets d LEFT JOIN LATERAL (SELECT id,version FROM experiment_dataset_versions WHERE dataset_id=d.id ORDER BY version DESC LIMIT 1) v ON true ORDER BY d.created_at DESC')).rows });
    if (method === 'POST') {
      const body = await readBody();
      if (!body.name?.trim()) return fail('数据集名称为必填');
      let cases;
      try { cases = validatedCases(body.cases); } catch (error) { return fail(error.message); }
      const id = uuid();
      await client.query('INSERT INTO experiment_datasets(id,name,owner_id) VALUES($1,$2,$3)', [id, body.name.trim(), me.id]);
      const version = await insertVersion(client, id, 1, cases.map(item => ({ caseKey: item.key, variables: item.variables, referenceAnswer: item.referenceAnswer, difficulty: item.difficulty, category: item.category })));
      return ok({ id, name: body.name.trim(), version }, 201);
    }
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
      return ok(await insertVersion(client, dataset.id, version, body.cases), 201);
    }
  }
  const versionRoute = pathname.match(/^\/api\/experiment-dataset-versions\/([^/]+)$/);
  if (versionRoute && method === 'GET') {
    const version = (await client.query('SELECT * FROM experiment_dataset_versions WHERE id=$1', [versionRoute[1]])).rows[0];
    if (!version) return fail('版本不存在', 404);
    const cases = (await client.query('SELECT id,case_key,variables,reference_answer,difficulty,category FROM experiment_dataset_cases WHERE dataset_version_id=$1 ORDER BY case_key', [version.id])).rows;
    return ok({ ...version, cases });
  }
  const datasetRunRoute = pathname.match(/^\/api\/experiment-definitions\/([^/]+)\/(dataset-run|regression)$/);
  if (datasetRunRoute && method === 'POST') return createBatch(client, datasetRunRoute[1], me, await readBody(), datasetRunRoute[2] === 'regression' ? 'regression' : 'dataset');
  const reportRoute = pathname.match(/^\/api\/experiment-batches\/([^/]+)\/report$/);
  if (reportRoute && method === 'GET') return regressionReport(client, reportRoute[1]);
  const annotationRoute = pathname.match(/^\/api\/experiment-runs\/([^/]+)\/annotation$/);
  if (annotationRoute) {
    const run = (await client.query('SELECT id,experiment_id FROM experiment_runs WHERE id=$1', [annotationRoute[1]])).rows[0];
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
