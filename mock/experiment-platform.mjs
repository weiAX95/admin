import crypto from 'node:crypto';
import { EXPERIMENT_TEMPLATES, estimateMaxCost, fillPrompt, validateDefinition, winRates } from './experiment-core.mjs';
import { executionConfigured } from './experiment-runner.mjs';

const uuid = () => crypto.randomUUID();
const ok = (data, status = 200) => ({ status, data });
const forbidden = () => ok({ error: '仅管理员可配置模型和预算' }, 403);
const own = (experiment, me) => me.role === 'admin' || experiment.owner_id === me.id;
const fail = (error, status = 400) => ok({ error }, status);

function mapRun(row) {
  return { id: row.id, batchId: row.batch_id, experimentId: row.experiment_id, variantId: row.variant_id, inputIndex: row.input_index, caseId: row.case_id, status: row.status, modelId: row.model_id, apiModel: row.api_model, parameters: row.parameters, output: row.output, promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, latencyMs: row.latency_ms, costUsd: row.cost_usd, autoScore: row.auto_score, scoreReason: row.score_reason, error: row.error, createdAt: row.created_at, completedAt: row.completed_at };
}
const mapVariant = row => ({ id: row.id, modelId: row.model_id, label: row.label, parameters: row.parameters, position: row.position });

async function getDefinition(client, id) {
  const experiment = (await client.query("SELECT * FROM experiments WHERE id=$1 AND record_kind='definition'", [id])).rows[0];
  if (!experiment) return null;
  const variants = (await client.query('SELECT * FROM experiment_variants WHERE experiment_id=$1 AND active=true ORDER BY position', [id])).rows.map(mapVariant);
  const batches = (await client.query('SELECT * FROM experiment_batches WHERE experiment_id=$1 ORDER BY created_at DESC LIMIT 100', [id])).rows;
  const runs = (await client.query('SELECT * FROM experiment_runs WHERE experiment_id=$1 ORDER BY created_at DESC LIMIT 1000', [id])).rows.map(mapRun);
  return { id: experiment.id, title: experiment.title, taskId: experiment.task_id, ownerId: experiment.owner_id, systemPrompt: experiment.system_prompt, userPrompt: experiment.user_prompt, promptVersionId: experiment.prompt_version_id, variables: experiment.variables, variants, batches: batches.map(batch => ({ id: batch.id, kind: batch.kind, status: batch.status, inputs: batch.inputs, createdAt: batch.created_at, completedAt: batch.completed_at, runs: runs.filter(run => run.batchId === batch.id), winRates: winRates(runs.filter(run => run.batchId === batch.id)) })), createdAt: experiment.created_at, updatedAt: experiment.updated_at };
}

async function createBatch(client, experimentId, me, body, kind = 'single') {
  if (!executionConfigured()) return fail('未配置 MODEL_API_BASE_URL 和 MODEL_API_KEY，暂不能真实执行', 409);
  const definition = await getDefinition(client, experimentId);
  if (!definition) return fail('实验定义不存在', 404);
  if (!own({ owner_id: definition.ownerId }, me)) return fail('无权执行该实验', 403);
  const settings = (await client.query('SELECT * FROM experiment_settings WHERE id=1')).rows[0];
  if (!settings.daily_budget_usd || !settings.concurrency_limit) return fail('管理员尚未配置每日预算和并发上限', 409);
  const inputs = kind === 'ab' ? body.inputs : [body.variables || definition.variables];
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 50 || inputs.some(input => !input || typeof input !== 'object' || Array.isArray(input))) return fail('输入组必须为 1–50 组变量映射');
  const variants = definition.variants.filter(variant => !body.variantIds || body.variantIds.includes(variant.id));
  if (!variants.length || variants.length > 20) return fail('请选择 1–20 个变体');
  const models = new Map((await client.query('SELECT * FROM experiment_models WHERE active=true')).rows.map(row => [row.id, row]));
  if (variants.some(variant => !models.has(variant.modelId))) return fail('变体模型已停用，请编辑实验后重试', 409);
  let prompts;
  try { prompts = inputs.map(input => {
    if (Object.values(input).some(value => typeof value !== 'string')) throw new Error('变量值必须为字符串');
    return { system: fillPrompt(definition.systemPrompt, input), user: fillPrompt(definition.userPrompt, input) };
  }); } catch (error) { return fail(error.message); }
  const estimate = estimateMaxCost(variants, inputs, models);
  const spent = Number((await client.query("SELECT COALESCE(sum(reserved_usd),0) AS total FROM experiment_runs WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date=(now() AT TIME ZONE 'Asia/Shanghai')::date")).rows[0].total);
  if (spent + estimate > settings.daily_budget_usd) return fail(`预计上限 $${estimate.toFixed(6)} 超过今日剩余额度 $${(settings.daily_budget_usd - spent).toFixed(6)}`, 409);
  const batchId = uuid();
  await client.query('INSERT INTO experiment_batches(id,experiment_id,owner_id,kind,status,inputs) VALUES($1,$2,$3,$4,$5,$6)', [batchId, experimentId, me.id, kind, 'queued', JSON.stringify(inputs)]);
  for (const variant of variants) for (let index = 0; index < inputs.length; index++) {
    const model = models.get(variant.modelId);
    const maxTokens = variant.parameters.max_tokens || 1024;
    const reserved = maxTokens * (model.input_usd_per_million + model.output_usd_per_million) / 1_000_000;
    await client.query('INSERT INTO experiment_runs(id,batch_id,experiment_id,variant_id,input_index,status,system_prompt,user_prompt,model_id,api_model,parameters,input_price,output_price,reserved_usd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [uuid(), batchId, experimentId, variant.id, index, 'queued', prompts[index].system, prompts[index].user, variant.modelId, model.api_model, JSON.stringify(variant.parameters), model.input_usd_per_million, model.output_usd_per_million, reserved]);
  }
  return ok({ batchId, status: 'queued', runCount: variants.length * inputs.length, estimatedMaxCostUsd: estimate }, 202);
}

export async function handleExperimentPlatform({ pathname, method, client, me, readBody }) {
  if (pathname === '/api/experiment-templates' && method === 'GET') return ok({ items: EXPERIMENT_TEMPLATES });
  if (pathname === '/api/experiment-platform/config') {
    if (method === 'GET') {
      const settings = (await client.query('SELECT * FROM experiment_settings WHERE id=1')).rows[0];
      const models = (await client.query('SELECT * FROM experiment_models ORDER BY created_at')).rows;
      return ok({ configured: executionConfigured(), dailyBudgetUsd: settings.daily_budget_usd, concurrencyLimit: settings.concurrency_limit, judgeModelId: settings.judge_model_id, models: models.map(model => ({ id: model.id, displayName: model.display_name, apiModel: model.api_model, inputUsdPerMillion: model.input_usd_per_million, outputUsdPerMillion: model.output_usd_per_million, active: model.active })) });
    }
    if (method === 'PUT') {
      if (me.role !== 'admin') return forbidden();
      const body = await readBody();
      if (typeof body.dailyBudgetUsd !== 'number' || !Number.isFinite(body.dailyBudgetUsd) || body.dailyBudgetUsd < 0 || body.dailyBudgetUsd > 1_000_000 || !Number.isInteger(body.concurrencyLimit) || body.concurrencyLimit < 0 || body.concurrencyLimit > 20) return fail('预算或并发上限无效');
      await client.query('UPDATE experiment_settings SET daily_budget_usd=$1,concurrency_limit=$2,judge_model_id=$3,updated_at=now() WHERE id=1', [body.dailyBudgetUsd, body.concurrencyLimit, body.judgeModelId || null]);
      return ok({ saved: true });
    }
  }
  if (pathname === '/api/experiment-platform/models' && method === 'POST') {
    if (me.role !== 'admin') return forbidden();
    const body = await readBody();
    if (!body.displayName?.trim() || !body.apiModel?.trim() || !Number.isFinite(body.inputUsdPerMillion) || body.inputUsdPerMillion < 0 || !Number.isFinite(body.outputUsdPerMillion) || body.outputUsdPerMillion < 0) return fail('模型名称、API 名称及非负价格为必填');
    const id = uuid();
    await client.query('INSERT INTO experiment_models(id,display_name,api_model,input_usd_per_million,output_usd_per_million) VALUES($1,$2,$3,$4,$5)', [id, body.displayName.trim(), body.apiModel.trim(), body.inputUsdPerMillion, body.outputUsdPerMillion]);
    return ok({ id }, 201);
  }
  if (pathname === '/api/experiment-platform/prompts') {
    if (method === 'GET') return ok({ items: (await client.query('SELECT p.id,p.name,v.id AS version_id,v.version,v.content FROM prompt_library p JOIN LATERAL (SELECT * FROM prompt_library_versions WHERE prompt_id=p.id ORDER BY version DESC LIMIT 1) v ON true ORDER BY p.created_at DESC')).rows });
    if (method === 'POST') {
      const body = await readBody();
      if (!body.name?.trim() || typeof body.content !== 'string') return fail('提示词名称和内容为必填');
      const id = uuid(), versionId = uuid();
      await client.query('INSERT INTO prompt_library(id,name,owner_id) VALUES($1,$2,$3)', [id, body.name.trim(), me.id]);
      await client.query('INSERT INTO prompt_library_versions(id,prompt_id,version,content) VALUES($1,$2,1,$3)', [versionId, id, body.content]);
      return ok({ id, versionId, version: 1 }, 201);
    }
  }
  const promptVersion = pathname.match(/^\/api\/experiment-platform\/prompts\/([^/]+)\/versions$/);
  if (promptVersion && method === 'POST') {
    const body = await readBody();
    const prompt = (await client.query('SELECT * FROM prompt_library WHERE id=$1', [promptVersion[1]])).rows[0];
    if (!prompt) return fail('提示词不存在', 404);
    if (me.role !== 'admin' && prompt.owner_id !== me.id) return fail('无权修改提示词', 403);
    if (typeof body.content !== 'string') return fail('content 必须为文本');
    const version = (await client.query('SELECT COALESCE(max(version),0)+1 AS n FROM prompt_library_versions WHERE prompt_id=$1', [prompt.id])).rows[0].n;
    const id = uuid();
    await client.query('INSERT INTO prompt_library_versions(id,prompt_id,version,content) VALUES($1,$2,$3,$4)', [id, prompt.id, version, body.content]);
    return ok({ id, version }, 201);
  }
  if (pathname === '/api/experiment-definitions' && method === 'POST') {
    const body = await readBody();
    const models = new Set((await client.query('SELECT id FROM experiment_models WHERE active=true')).rows.map(row => row.id));
    let definition;
    try { definition = validateDefinition(body, models); } catch (error) { return fail(error.message); }
    if (definition.taskId && !(await client.query('SELECT 1 FROM tasks WHERE id=$1', [definition.taskId])).rowCount) return fail('关联任务不存在');
    if (definition.promptVersionId && !(await client.query('SELECT 1 FROM prompt_library_versions WHERE id=$1', [definition.promptVersionId])).rowCount) return fail('提示词版本不存在');
    const id = uuid();
    await client.query("INSERT INTO experiments(id,title,task_id,prompt,model,params,result,score,owner_id,record_kind,system_prompt,user_prompt,prompt_version_id,variables,created_at,updated_at) VALUES($1,$2,$3,'','','','',0,$4,'definition',$5,$6,$7,$8,now(),now())", [id, definition.title, definition.taskId, me.id, definition.systemPrompt, definition.userPrompt, definition.promptVersionId, JSON.stringify(definition.variables)]);
    for (const variant of definition.variants) await client.query('INSERT INTO experiment_variants(id,experiment_id,model_id,label,parameters,position) VALUES($1,$2,$3,$4,$5,$6)', [variant.id, id, variant.modelId, variant.label, JSON.stringify(variant.parameters), variant.position]);
    if (body.execute) {
      const run = await createBatch(client, id, me, { variables: definition.variables }, 'single');
      if (run.status !== 202) throw new Error(run.data.error);
    }
    return ok(await getDefinition(client, id), 201);
  }
  const definitionRoute = pathname.match(/^\/api\/experiment-definitions\/([^/]+)$/);
  if (definitionRoute) {
    const id = definitionRoute[1];
    if (method === 'GET') { const value = await getDefinition(client, id); return value ? ok(value) : fail('实验定义不存在', 404); }
    if (method === 'PUT') {
      const row = (await client.query('SELECT owner_id FROM experiments WHERE id=$1 AND record_kind=$2', [id, 'definition'])).rows[0];
      if (!row) return fail('实验定义不存在', 404);
      if (!own(row, me)) return fail('无权修改该实验', 403);
      const body = await readBody();
      const models = new Set((await client.query('SELECT id FROM experiment_models WHERE active=true')).rows.map(item => item.id));
      let definition;
      try { definition = validateDefinition(body, models); } catch (error) { return fail(error.message); }
      await client.query('UPDATE experiments SET title=$2,task_id=$3,system_prompt=$4,user_prompt=$5,prompt_version_id=$6,variables=$7,updated_at=now() WHERE id=$1', [id, definition.title, definition.taskId, definition.systemPrompt, definition.userPrompt, definition.promptVersionId, JSON.stringify(definition.variables)]);
      await client.query('UPDATE experiment_variants SET active=false WHERE experiment_id=$1', [id]);
      for (const variant of definition.variants) await client.query('INSERT INTO experiment_variants(id,experiment_id,model_id,label,parameters,position) VALUES($1,$2,$3,$4,$5,$6)', [variant.id, id, variant.modelId, variant.label, JSON.stringify(variant.parameters), variant.position]);
      return ok(await getDefinition(client, id));
    }
  }
  const runRoute = pathname.match(/^\/api\/experiment-definitions\/([^/]+)\/(run|batches)$/);
  if (runRoute && method === 'POST') return createBatch(client, runRoute[1], me, await readBody(), runRoute[2] === 'batches' ? 'ab' : 'single');
  const batchRoute = pathname.match(/^\/api\/experiment-batches\/([^/]+)$/);
  if (batchRoute && method === 'GET') {
    const row = (await client.query('SELECT * FROM experiment_batches WHERE id=$1', [batchRoute[1]])).rows[0];
    if (!row) return fail('批次不存在', 404);
    const runs = (await client.query('SELECT * FROM experiment_runs WHERE batch_id=$1 ORDER BY input_index,created_at', [row.id])).rows.map(mapRun);
    return ok({ id: row.id, experimentId: row.experiment_id, kind: row.kind, status: row.status, inputs: row.inputs, runs, winRates: winRates(runs) });
  }
  const retryRoute = pathname.match(/^\/api\/experiment-batches\/([^/]+)\/retry$/);
  if (retryRoute && method === 'POST') {
    const batch = (await client.query('SELECT b.*,e.owner_id FROM experiment_batches b JOIN experiments e ON e.id=b.experiment_id WHERE b.id=$1', [retryRoute[1]])).rows[0];
    if (!batch) return fail('批次不存在', 404);
    if (!own(batch, me)) return fail('无权重试', 403);
    if (!executionConfigured()) return fail('模型 API 未配置', 409);
    const count = (await client.query("UPDATE experiment_runs SET status='queued',error=NULL,started_at=NULL,completed_at=NULL WHERE batch_id=$1 AND status='failed' RETURNING id", [batch.id])).rowCount;
    if (!count) return fail('没有失败项可重试', 409);
    await client.query("UPDATE experiment_batches SET status='queued',completed_at=NULL WHERE id=$1", [batch.id]);
    return ok({ queued: count }, 202);
  }
  return null;
}
