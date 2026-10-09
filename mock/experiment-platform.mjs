import crypto from 'node:crypto';
import { EXPERIMENT_TEMPLATES, fillPrompt, validateDefinition, winRates } from './experiment-core.mjs';
import { executionConfigured } from './experiment-runner.mjs';
import { checkPromptCompliance, renderPromptVersion } from './prompts.mjs';
import {mediaCost,preflightMedia,preflightOutput,validateModelCapabilities} from './model-capabilities.mjs';
import {modelConnectionAvailable} from './model-connections.mjs';
import {modelUsable,supportedProvider,validateRegistry} from './model-governance.mjs';
import {checkTokenReservations,reserveRunTokens} from './model-quotas.mjs';
import {checkModelRate,reserveModelRate} from './model-rate-limits.mjs';
import { caseInputFingerprint } from './evaluation-datasets.mjs';
import { pythonMetricAvailable } from './evaluation-python-worker.mjs';

const uuid = () => crypto.randomUUID();
const ok = (data, status = 200) => ({ status, data });
const forbidden = () => ok({ error: '仅管理员可配置模型和预算' }, 403);
const own = (experiment, me) => me.role === 'admin' || experiment.owner_id === me.id;
const fail = (error, status = 400) => ok({ error }, status);

function mapRun(row) {
  return { id: row.id, batchId: row.batch_id, experimentId: row.experiment_id, variantId: row.variant_id, inputIndex: row.input_index, caseId: row.case_id, status: row.status, modelId: row.model_id, apiModel: row.api_model, provider:row.provider, parameters: row.parameters, output: row.output, outputParts:row.output_parts, toolCalls:row.tool_calls, mediaUsage:row.media_usage, mediaPriceSnapshot:row.media_price_snapshot, promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, latencyMs: row.latency_ms, costUsd: row.cost_usd, autoScore: row.auto_score, scoreReason: row.score_reason, error: row.error, createdAt: row.created_at, completedAt: row.completed_at };
}
const mapVariant = row => ({ id: row.id, modelId: row.model_id, label: row.label, parameters: row.parameters, position: row.position });
const ceiling = value => Math.ceil(value * 1_000_000) / 1_000_000;
function runCeiling(variant, prompt, model, judge, usage={}) {
  const outputTokens = variant.parameters.max_tokens || 1024;
  const inputTokens = Math.max(1, [...prompt.system, ...prompt.user].length);
  const main = (inputTokens * model.input_usd_per_million + outputTokens * model.output_usd_per_million) / 1_000_000;
  const judgeInputTokens = inputTokens + outputTokens * 4 + 1000;
  const outputKind=variant.parameters.output_kind || 'text';
  const judgeMedia=outputKind==='image'?{imageCount:model.provider==='openai'?1:4,audioSeconds:0,videoSeconds:0}:outputKind==='audio'?{imageCount:0,audioSeconds:600,videoSeconds:0}:{imageCount:0,audioSeconds:0,videoSeconds:0};
  const judgeCost = judge ? (judgeInputTokens * judge.input_usd_per_million + 300 * judge.output_usd_per_million) / 1_000_000 + mediaCost(judgeMedia,judge.media_pricing || {}) : 0;
  return ceiling(main + judgeCost + mediaCost(usage,model.media_pricing || {}) + preflightOutput(model,variant.parameters.output_kind || 'text'));
}

async function getDefinition(client, id) {
  const experiment = (await client.query("SELECT * FROM experiments WHERE id=$1 AND record_kind='definition' AND deleted_at IS NULL", [id])).rows[0];
  if (!experiment) return null;
  const variants = (await client.query('SELECT * FROM experiment_variants WHERE experiment_id=$1 AND active=true ORDER BY position', [id])).rows.map(mapVariant);
  const batches = (await client.query('SELECT * FROM experiment_batches WHERE experiment_id=$1 ORDER BY created_at DESC LIMIT 100', [id])).rows;
  const runs = (await client.query('SELECT * FROM experiment_runs WHERE experiment_id=$1 ORDER BY created_at DESC LIMIT 1000', [id])).rows.map(mapRun);
  const counts = (await client.query(`SELECT batch_id, count(*)::int AS total_runs,
    count(*) FILTER (WHERE status IN ('completed','failed'))::int AS finished_runs,
    count(*) FILTER (WHERE status='failed')::int AS failed_runs
    FROM experiment_runs WHERE experiment_id=$1 GROUP BY batch_id`, [id])).rows;
  const countsByBatch = new Map(counts.map(row => [row.batch_id, row]));
  const cumulativeCostUsd = (await client.query("SELECT COALESCE(sum(cost_usd),0) AS total FROM experiment_runs WHERE experiment_id=$1 AND status='completed'", [id])).rows[0].total;
  return { id: experiment.id, title: experiment.title, taskId: experiment.task_id, ownerId: experiment.owner_id, chainId: experiment.chain_id, cumulativeCostUsd, systemPrompt: experiment.system_prompt, userPrompt: experiment.user_prompt, promptVersionId: experiment.prompt_version_id, variables: experiment.variables, variants, batches: batches.map(batch => ({ id: batch.id, kind: batch.kind, status: batch.status, inputs: batch.inputs, createdAt: batch.created_at, completedAt: batch.completed_at, totalRuns: countsByBatch.get(batch.id)?.total_runs || 0, finishedRuns: countsByBatch.get(batch.id)?.finished_runs || 0, failedRuns: countsByBatch.get(batch.id)?.failed_runs || 0, runs: runs.filter(run => run.batchId === batch.id), winRates: winRates(runs.filter(run => run.batchId === batch.id)) })), createdAt: experiment.created_at, updatedAt: experiment.updated_at };
}

export async function createBatch(client, experimentId, me, body, kind = 'single') {
  if (!await executionConfigured(client)) return fail('尚未配置任何模型供应商凭据，暂不能真实执行', 409);
  const definition = await getDefinition(client, experimentId);
  if (!definition) return fail('实验定义不存在', 404);
  if (!own({ owner_id: definition.ownerId }, me)) return fail('无权执行该实验', 403);
  const settings = (await client.query('SELECT * FROM experiment_settings WHERE id=1')).rows[0];
  if (!settings.daily_budget_usd || !settings.concurrency_limit) return fail('管理员尚未配置每日预算或并发上限', 409);
  let cases = [];
  if (kind === 'dataset' || kind === 'regression') {
    if (!body.datasetVersionId) return fail('请选择数据集版本');
    cases = (await client.query('SELECT * FROM experiment_dataset_cases WHERE dataset_version_id=$1 ORDER BY case_key', [body.datasetVersionId])).rows;
    if (!cases.length) return fail('数据集版本不存在或没有用例', 404);
  }
  const metricVersionId = body.metricVersionId || 'default-v1';
  const metricDefinition=(await client.query('SELECT rule_type FROM experiment_metric_versions WHERE id=$1', [metricVersionId])).rows[0];
  if (!metricDefinition) return fail('指标版本不存在', 404);
  if (metricDefinition.rule_type==='custom_python' && !(await pythonMetricAvailable())) return fail('隔离 Python 指标容器不可用',409);
  if (metricDefinition.rule_type==='bertscore' && (process.env.EVALUATION_BERTSCORE_ENABLED!=='true' || !(await pythonMetricAvailable('bertscore')))) return fail('BERTScore worker 不可用',409);
  if (kind === 'regression') {
    const baseline = (await client.query('SELECT * FROM experiment_batches WHERE id=$1', [body.baselineBatchId])).rows[0];
    if (!baseline) return fail('固定 baseline 不存在', 409);
    if (baseline.metric_version_id !== metricVersionId) return fail('baseline 指标版本不同，不能比较', 409);
    const baselineVersion = (await client.query('SELECT dataset_id FROM experiment_dataset_versions WHERE id=$1', [baseline.dataset_version_id])).rows[0];
    const currentVersion = (await client.query('SELECT dataset_id FROM experiment_dataset_versions WHERE id=$1', [body.datasetVersionId])).rows[0];
    if (!baselineVersion || baselineVersion.dataset_id !== currentVersion?.dataset_id) return fail('baseline 须来自同一数据集', 409);
    const baselineRuns = (await client.query('SELECT r.status,r.auto_score,c.* FROM experiment_runs r JOIN experiment_dataset_cases c ON c.id=r.case_id WHERE r.batch_id=$1', [baseline.id])).rows;
    const comparable = new Set(baselineRuns.filter(run => run.status === 'completed' && run.auto_score !== null).map(run => `${run.case_key}:${caseInputFingerprint(run)}`));
    if (!cases.some(item => comparable.has(`${item.case_key}:${caseInputFingerprint(item)}`))) return fail('baseline 没有相同用例键、输入及指标版本的可比分数', 409);
  }
  const inputs = cases.length ? cases.map(item => item.variables) : kind === 'ab' ? body.inputs : [body.variables || definition.variables];
  const inputLimit = cases.length ? 10000 : 50;
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > inputLimit || inputs.some(input => !input || typeof input !== 'object' || Array.isArray(input))) return fail(`输入组必须为 1–${inputLimit} 组变量映射`);
  if (body.variantIds !== undefined && (!Array.isArray(body.variantIds) || body.variantIds.some(id => typeof id !== 'string'))) return fail('variantIds 必须为变体 ID 数组');
  const variants = definition.variants.filter(variant => !body.variantIds || body.variantIds.includes(variant.id));
  if (!variants.length || variants.length > 20) return fail('请选择 1–20 个变体');
  if(variants.some(variant=>(variant.parameters.output_kind || 'text')==='text')&&!settings.judge_model_id) return fail('文本输出需要配置 LLM Judge',409);
  if ((kind === 'dataset' || kind === 'regression') && variants.length !== 1) return fail('数据集评测和回归每批次必须选择一个变体，以便逐用例与 baseline 对比');
  const catalog=(await client.query("SELECT * FROM experiment_models WHERE active=true AND status='active'")).rows;
  const models = new Map(catalog.filter(row=>modelUsable(row,me)).map(row => [row.id, row]));
  const judge=catalog.find(row=>row.id===settings.judge_model_id);
  if(judge)models.set(judge.id,judge);
  const available = new Map(await Promise.all([...models.values()].map(async model => [model.id, await modelConnectionAvailable(client, model)])));
  if (variants.some(variant => !modelUsable(models.get(variant.modelId),me))) return fail('变体模型已停用或无访问权限，请编辑实验后重试', 409);
  if (variants.some(variant=>{const model=models.get(variant.modelId);return model.max_output_tokens!==null && variant.parameters.max_tokens>model.max_output_tokens;}))return fail('变体输出 token 超过模型上限',409);
  if (variants.some(variant=>(variant.parameters.output_kind || 'text')==='text') && !judge) return fail('LLM Judge 模型未启用', 409);
  if(judge && !available.get(judge.id) && variants.some(variant=>(variant.parameters.output_kind || 'text')==='text')) return fail('LLM Judge 供应商凭据未配置',409);
  const judgeFor=kind=>{
    if(!judge) return null;
    if(kind==='text') return judge;
    if(!available.get(judge.id)||!judge.capabilities?.input?.includes(kind)||!judge.capabilities?.output?.includes('text')) return null;
    if(kind==='image' && judge.media_pricing?.imageInputUsdEach===undefined) return null;
    if(kind==='audio' && (judge.provider!=='gemini'||judge.media_pricing?.audioInputUsdPerSecond===undefined)) return null;
    return judge;
  };
  if(variants.some(variant=>!available.get(variant.modelId))) return fail('部分变体的供应商凭据未配置',409);
  let prompts, usedVersions=[],toolSchema=null;
  try {
    const version=definition.promptVersionId ? (await client.query('SELECT * FROM prompt_library_versions WHERE id=$1',[definition.promptVersionId])).rows[0] : null;
    const linked=version && version.content===definition.systemPrompt;
    prompts=[];
    for (const input of inputs) {
      if (Object.values(input).some(value => typeof value !== 'string')) throw new Error('变量值必须为字符串');
      let system;
      if (linked) {
        const raw=await renderPromptVersion(client,version,input);
        system=raw.content;
        usedVersions=raw.versionIds;
        toolSchema=version.tool_schema;
        const user=fillPrompt(definition.userPrompt,input);
        const messages=[...(system?[{role:'system',parts:[{type:'text',text:system}]}]:[]),...raw.blocks,...(user?[{role:'user',parts:[{type:'text',text:user}]}]:[])];
        prompts.push({system,user,messages});
        continue;
      } else system=fillPrompt(definition.systemPrompt,input);
      const user=fillPrompt(definition.userPrompt,input);
      prompts.push({system,user,messages:[{role:'system',content:system},{role:'user',content:user}]});
    }
    if (cases.length) for (const [index, item] of cases.entries()) {
      const prompt = prompts[index];
      const context = (item.context_payload || []).map(message => ({ role: message.role, parts: message.parts }));
      const inputParts = item.input_payload?.parts || [];
      const alreadyFilled = inputParts.length === 1 && inputParts[0].type === 'text' && definition.userPrompt.includes('{{question}}') && inputParts[0].text === inputs[index].question;
      prompt.messages = [...prompt.messages, ...context, ...(!inputParts.length || alreadyFilled ? [] : [{ role: 'user', parts: inputParts }])];
    }
  } catch (error) { return fail(error.message); }
  const usageByVariant=new Map();
  try {
    for(const variant of variants) {
      const model=models.get(variant.modelId);
      const usages=[];
      preflightOutput(model,variant.parameters.output_kind || 'text');
      for(const prompt of prompts) {
        if(variant.parameters.output_kind==='image' && model.provider==='openai' && toolSchema) throw new Error('OpenAI 图片生成不能同时配置自定义工具');
        if(variant.parameters.output_kind==='audio' && (prompt.system.trim() || toolSchema || prompt.messages.some(message=>message.role!=='user' && (message.content?.trim() || message.parts?.length) || (message.parts || []).some(part=>part.type!=='text')))) throw new Error('Gemini TTS 仅支持用户纯文本输入，不能带系统提示、媒体或工具');
        usages.push(await preflightMedia(client,prompt.messages,model,toolSchema));
      }
      usageByVariant.set(variant.id,usages);
    }
  } catch(error) {return fail(error.message,409);}
  const retryLimit = kind === 'dataset' || kind === 'regression' ? 2 : 0;
  const estimate = variants.reduce((total, variant) => total + prompts.reduce((sum, prompt,index) => sum + runCeiling(variant, prompt, models.get(variant.modelId), judgeFor(variant.parameters.output_kind || 'text'),usageByVariant.get(variant.id)[index]), 0), 0) * (retryLimit + 1);
  const spent = Number((await client.query("SELECT COALESCE(sum(reserved_usd),0) AS total FROM experiment_runs WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date=(now() AT TIME ZONE 'Asia/Shanghai')::date")).rows[0].total);
  if (spent + estimate > settings.daily_budget_usd) return fail(`预计上限 $${estimate.toFixed(6)} 超过今日剩余额度 $${(settings.daily_budget_usd - spent).toFixed(6)}`, 409);
  const quotaByRun=new Map(),quotaRequests=[];
  for(const variant of variants)for(let index=0;index<prompts.length;index++){
    const prompt=prompts[index],usage=usageByVariant.get(variant.id)[index];
    const maxOutput=variant.parameters.max_tokens||1024;
    const inputAllowance=Math.max(1,Buffer.byteLength(JSON.stringify(prompt.messages),'utf8'));
    const mediaRun=Boolean(usage.imageCount||usage.audioSeconds||usage.videoSeconds||(variant.parameters.output_kind||'text')!=='text');
    const times=retryLimit+1;
    const model=models.get(variant.modelId);
    const amounts=new Map([[variant.modelId,{tokens:(mediaRun&&model.context_window?model.context_window:inputAllowance+maxOutput)*times,needsContext:mediaRun&&!model.context_window,calls:times}]]);
    const selectedJudge=judgeFor(variant.parameters.output_kind||'text');
    if(selectedJudge){const judgeMedia=mediaRun;const tokens=(judgeMedia&&selectedJudge.context_window?selectedJudge.context_window:inputAllowance+maxOutput*4+1300)*times;const prior=amounts.get(selectedJudge.id);amounts.set(selectedJudge.id,{tokens:(prior?.tokens||0)+tokens,needsContext:Boolean(prior?.needsContext||judgeMedia&&!selectedJudge.context_window),calls:(prior?.calls||0)+times});}
    const key=`${variant.id}:${index}`;
    const entries=[...amounts].map(([modelId,value])=>({modelId,...value}));
    quotaByRun.set(key,entries);
    quotaRequests.push(...entries);
  }
  const quotaCheck=await checkTokenReservations(client,me,quotaRequests,{dryRun:Boolean(body.dryRun)});
  if(quotaCheck.status!==200)return quotaCheck;
  const rateCheck=await checkModelRate(client,quotaRequests);
  if(rateCheck.status!==200)return rateCheck;
  if (body.dryRun) return ok({ runCount: variants.length * inputs.length, estimatedMaxCostUsd: estimate, remainingBudgetUsd: settings.daily_budget_usd - spent });
  const batchId = uuid();
  const runReservations=[];
  await client.query('INSERT INTO experiment_batches(id,experiment_id,owner_id,kind,status,inputs,dataset_version_id,baseline_batch_id,metric_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [batchId, experimentId, me.id, kind, 'queued', JSON.stringify(inputs), body.datasetVersionId || null, body.baselineBatchId || null, metricVersionId]);
  for (const variant of variants) for (let index = 0; index < inputs.length; index++) {
    const model = models.get(variant.modelId);
    const mediaUsage=usageByVariant.get(variant.id)[index];
    const runJudge=judgeFor(variant.parameters.output_kind || 'text');
    const reserved = runCeiling(variant, prompts[index], model, runJudge,mediaUsage);
    const reservedMedia=mediaCost(mediaUsage,model.media_pricing || {});
    const runId=uuid();
    await client.query('INSERT INTO experiment_runs(id,batch_id,experiment_id,variant_id,input_index,case_id,status,system_prompt,user_prompt,model_id,api_model,parameters,input_price,output_price,reserved_usd,judge_model_id,judge_api_model,judge_input_price,judge_output_price,provider,judge_provider,request_messages,tools_schema,media_price_snapshot,media_usage,reserved_media_cost,judge_media_price_snapshot,retry_limit,connection_id,judge_connection_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)', [runId, batchId, experimentId, variant.id, index, cases[index]?.id || null, 'queued', prompts[index].system, prompts[index].user, variant.modelId, model.api_model, JSON.stringify(variant.parameters), model.input_usd_per_million, model.output_usd_per_million, reserved * (retryLimit + 1), runJudge?.id || null, runJudge?.api_model || null, runJudge?.input_usd_per_million ?? null, runJudge?.output_usd_per_million ?? null,model.provider,runJudge?.provider || 'legacy',JSON.stringify(prompts[index].messages),JSON.stringify(toolSchema),JSON.stringify(model.media_pricing),JSON.stringify(mediaUsage),reservedMedia,JSON.stringify(runJudge?.media_pricing || {}),retryLimit,model.connection_id,runJudge?.connection_id || null]);
    runReservations.push(...quotaByRun.get(`${variant.id}:${index}`).map(item=>({...item,runId})));
    for (const versionId of usedVersions) await client.query('INSERT INTO prompt_run_uses(run_id,version_id,direct) VALUES($1,$2,$3)',[runId,versionId,versionId===definition.promptVersionId]);
  }
  await reserveRunTokens(client,me,runReservations,quotaCheck);
  await reserveModelRate(client,runReservations,rateCheck);
  return ok({ batchId, status: 'queued', runCount: variants.length * inputs.length, estimatedMaxCostUsd: estimate }, 202);
}

export async function handleExperimentPlatform({ pathname, method, client, me, readBody }) {
  if (pathname === '/api/experiment-templates' && method === 'GET') return ok({ items: EXPERIMENT_TEMPLATES });
  if (pathname === '/api/experiment-platform/config') {
    if (method === 'GET') {
      const settings = (await client.query('SELECT * FROM experiment_settings WHERE id=1')).rows[0];
      const models = (await client.query('SELECT * FROM experiment_models ORDER BY created_at')).rows.filter(row=>me.role==='admin'||modelUsable(row,me));
      const availability = await Promise.all(models.map(model => modelConnectionAvailable(client, model)));
      return ok({ configured: await executionConfigured(client), dailyBudgetUsd: settings.daily_budget_usd, concurrencyLimit: settings.concurrency_limit, judgeModelId: settings.judge_model_id, models: models.map((model, index) => ({ id: model.id, name:model.name, displayName: model.display_name, apiModel: model.api_model, provider:model.provider,connectionId:model.connection_id,capabilities:model.capabilities,mediaPricing:model.media_pricing,configured:availability[index],inputUsdPerMillion: model.input_usd_per_million, outputUsdPerMillion: model.output_usd_per_million, active: model.active, status:model.status,allowedRoles:model.allowed_roles,endpointUrl:model.endpoint_url,apiVersion:model.api_version,contextWindow:model.context_window,maxOutputTokens:model.max_output_tokens,featureTags:model.feature_tags,adapterReady:['legacy','openai','qwen','gemini'].includes(model.provider) })) });
    }
    if (method === 'PUT') {
      if (me.role !== 'admin') return forbidden();
      const body = await readBody();
      if (typeof body.dailyBudgetUsd !== 'number' || !Number.isFinite(body.dailyBudgetUsd) || body.dailyBudgetUsd < 0 || body.dailyBudgetUsd > 1_000_000 || !Number.isInteger(body.concurrencyLimit) || body.concurrencyLimit < 0 || body.concurrencyLimit > 20) return fail('预算或并发上限无效');
      if (body.judgeModelId && !(await client.query("SELECT 1 FROM experiment_models WHERE id=$1 AND active=true AND status='active'", [body.judgeModelId])).rowCount) return fail('LLM Judge 模型不可用');
      await client.query('UPDATE experiment_settings SET daily_budget_usd=$1,concurrency_limit=$2,judge_model_id=$3,updated_at=now() WHERE id=1', [body.dailyBudgetUsd, body.concurrencyLimit, body.judgeModelId || null]);
      return ok({ saved: true });
    }
  }
  if (pathname === '/api/experiment-platform/models' && method === 'POST') {
    if (me.role !== 'admin') return forbidden();
    const body = await readBody();
    if (!body.displayName?.trim() || !body.apiModel?.trim() || !Number.isFinite(body.inputUsdPerMillion) || body.inputUsdPerMillion < 0 || !Number.isFinite(body.outputUsdPerMillion) || body.outputUsdPerMillion < 0) return fail('模型名称、API 名称及非负价格为必填');
    let configured;
    try {configured=validateModelCapabilities(body.provider || 'legacy',body.capabilities || {input:['text'],output:['text'],tools:false},body.mediaPricing || {});} catch(error) {return fail(error.message);}
    let registry;
    try{registry=validateRegistry({...body,name:body.name||`${configured.provider}:${body.apiModel.trim()}`});}catch(error){return fail(error.message);}
    if((await client.query('SELECT 1 FROM experiment_models WHERE name=$1',[registry.name])).rowCount)return fail('模型唯一标识已存在',409);
    const id = uuid();
    if (body.connectionId && !(await client.query('SELECT 1 FROM model_connections WHERE id=$1 AND provider=$2 AND active=true', [body.connectionId, configured.provider])).rowCount) return fail('模型连接不存在或供应商不匹配');
    await client.query('INSERT INTO experiment_models(id,display_name,api_model,input_usd_per_million,output_usd_per_million,provider,capabilities,media_pricing,connection_id,name,status,allowed_roles,endpoint_url,api_version,context_window,max_output_tokens,feature_tags,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)', [id, body.displayName.trim(), body.apiModel.trim(), body.inputUsdPerMillion, body.outputUsdPerMillion,configured.provider,JSON.stringify(configured.capabilities),JSON.stringify(configured.mediaPricing),body.connectionId || null,registry.name,registry.status,registry.allowedRoles,registry.endpointUrl,registry.apiVersion,registry.contextWindow,registry.maxOutputTokens,registry.featureTags,supportedProvider.has(configured.provider)]);
    return ok({ id }, 201);
  }
  const modelRoute = pathname.match(/^\/api\/experiment-platform\/models\/([^/]+)$/);
  if (modelRoute && method === 'PATCH') {
    if (me.role !== 'admin') return forbidden();
    const body = await readBody();
    if (typeof body.displayName !== 'string' || !body.displayName.trim() || typeof body.inputUsdPerMillion !== 'number' || !Number.isFinite(body.inputUsdPerMillion) || body.inputUsdPerMillion < 0 || typeof body.outputUsdPerMillion !== 'number' || !Number.isFinite(body.outputUsdPerMillion) || body.outputUsdPerMillion < 0 || typeof body.active !== 'boolean') return fail('模型价格或状态无效');
    const current=(await client.query('SELECT * FROM experiment_models WHERE id=$1',[modelRoute[1]])).rows[0];
    if(!current) return fail('模型不存在',404);
    let registry;
    try{registry=validateRegistry(body,current);}catch(error){return fail(error.message);}
    if((await client.query('SELECT 1 FROM experiment_models WHERE name=$1 AND id<>$2',[registry.name,current.id])).rowCount)return fail('模型唯一标识已存在',409);
    let configured;
    try {configured=validateModelCapabilities(body.provider || current.provider,body.capabilities || current.capabilities,body.mediaPricing || current.media_pricing);} catch(error) {return fail(error.message);}
    const connectionId = body.connectionId === undefined ? current.connection_id : body.connectionId || null;
    if (connectionId && !(await client.query('SELECT 1 FROM model_connections WHERE id=$1 AND provider=$2 AND active=true', [connectionId, configured.provider])).rowCount) return fail('模型连接不存在或供应商不匹配');
    const result = await client.query('UPDATE experiment_models SET display_name=$2,input_usd_per_million=$3,output_usd_per_million=$4,active=$5,provider=$6,capabilities=$7,media_pricing=$8,connection_id=$9,name=$10,status=$11,allowed_roles=$12,endpoint_url=$13,api_version=$14,context_window=$15,max_output_tokens=$16,feature_tags=$17 WHERE id=$1 RETURNING id', [modelRoute[1],body.displayName.trim(),body.inputUsdPerMillion,body.outputUsdPerMillion,body.active&&supportedProvider.has(configured.provider),configured.provider,JSON.stringify(configured.capabilities),JSON.stringify(configured.mediaPricing),connectionId,registry.name,registry.status,registry.allowedRoles,registry.endpointUrl,registry.apiVersion,registry.contextWindow,registry.maxOutputTokens,registry.featureTags]);
    return result.rowCount ? ok({ id: modelRoute[1] }) : fail('模型不存在',404);
  }
  if (pathname === '/api/experiment-platform/prompts') {
    if (method === 'GET') return ok({ items: (await client.query('SELECT p.id,p.name,v.id AS version_id,v.version,v.content FROM prompt_library p JOIN prompt_library_versions v ON v.prompt_id=p.id ORDER BY p.created_at DESC,v.version DESC')).rows });
    if (method === 'POST') {
      const body = await readBody();
      if (!body.name?.trim() || typeof body.content !== 'string') return fail('提示词名称和内容为必填');
      const checked = await checkPromptCompliance(client, body, me);
      if (checked) return checked;
      const id = uuid(), versionId = uuid();
      await client.query('INSERT INTO prompt_library(id,name,owner_id) VALUES($1,$2,$3)', [id, body.name.trim(), me.id]);
      await client.query('INSERT INTO prompt_library_versions(id,prompt_id,version,semver,content,author_id,change_summary) VALUES($1,$2,1,$3,$4,$5,$6)', [versionId, id, '1.0.0', body.content, me.id, '初始版本']);
      return ok({ id, versionId, version: 1 }, 201);
    }
  }
  const promptVersion = pathname.match(/^\/api\/experiment-platform\/prompts\/([^/]+)\/versions$/);
  if (promptVersion && method === 'POST') {
    const body = await readBody();
    const prompt = (await client.query('SELECT * FROM prompt_library WHERE id=$1 FOR UPDATE', [promptVersion[1]])).rows[0];
    if (!prompt) return fail('提示词不存在', 404);
    if (me.role !== 'admin' && prompt.owner_id !== me.id) return fail('无权修改提示词', 403);
    if (typeof body.content !== 'string') return fail('content 必须为文本');
    const checked = await checkPromptCompliance(client, body, me, prompt.id);
    if (checked) return checked;
    const last = (await client.query('SELECT version,semver FROM prompt_library_versions WHERE prompt_id=$1 ORDER BY version DESC LIMIT 1', [prompt.id])).rows[0];
    const version = last.version + 1;
    const bits = last.semver.split('.').map(Number);
    const semver = `${bits[0]}.${bits[1]}.${bits[2]+1}`;
    const id = uuid();
    await client.query('INSERT INTO prompt_library_versions(id,prompt_id,version,semver,content,author_id,change_summary) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, prompt.id, version, semver, body.content, me.id, body.content.slice(0,100)]);
    return ok({ id, version }, 201);
  }
  if (pathname === '/api/experiment-definitions' && method === 'POST') {
    const body = await readBody();
    const models = new Set((await client.query("SELECT * FROM experiment_models WHERE active=true AND status='active'")).rows.filter(row=>modelUsable(row,me)).map(row => row.id));
    let definition;
    try { definition = validateDefinition(body, models); } catch (error) { return fail(error.message); }
    if (definition.taskId && !(await client.query('SELECT 1 FROM tasks WHERE id=$1', [definition.taskId])).rowCount) return fail('关联任务不存在');
    if (definition.promptVersionId) {
      const source=(await client.query('SELECT content FROM prompt_library_versions WHERE id=$1',[definition.promptVersionId])).rows[0];
      if (!source) return fail('提示词版本不存在');
      if (source.content!==definition.systemPrompt) definition.promptVersionId=null;
    }
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
      const models = new Set((await client.query("SELECT * FROM experiment_models WHERE active=true AND status='active'")).rows.filter(row=>modelUsable(row,me)).map(item => item.id));
      let definition;
      try { definition = validateDefinition(body, models); } catch (error) { return fail(error.message); }
      if (definition.taskId && !(await client.query('SELECT 1 FROM tasks WHERE id=$1', [definition.taskId])).rowCount) return fail('关联任务不存在');
      if (definition.promptVersionId) {
        const source=(await client.query('SELECT content FROM prompt_library_versions WHERE id=$1',[definition.promptVersionId])).rows[0];
        if (!source) return fail('提示词版本不存在');
        if (source.content!==definition.systemPrompt) definition.promptVersionId=null;
      }
      await client.query('UPDATE experiments SET title=$2,task_id=$3,system_prompt=$4,user_prompt=$5,prompt_version_id=$6,variables=$7,updated_at=now() WHERE id=$1', [id, definition.title, definition.taskId, definition.systemPrompt, definition.userPrompt, definition.promptVersionId, JSON.stringify(definition.variables)]);
      await client.query('UPDATE experiment_variants SET active=false WHERE experiment_id=$1', [id]);
      for (const variant of definition.variants) await client.query('INSERT INTO experiment_variants(id,experiment_id,model_id,label,parameters,position) VALUES($1,$2,$3,$4,$5,$6)', [variant.id, id, variant.modelId, variant.label, JSON.stringify(variant.parameters), variant.position]);
      return ok(await getDefinition(client, id));
    }
  }
  const runRoute = pathname.match(/^\/api\/experiment-definitions\/([^/]+)\/(run|batches)$/);
  if (runRoute && method === 'POST') return createBatch(client, runRoute[1], me, await readBody(), runRoute[2] === 'batches' ? 'ab' : 'single');
  const estimateRoute = pathname.match(/^\/api\/experiment-definitions\/([^/]+)\/estimate$/);
  if (estimateRoute && method === 'POST') {
    const body = await readBody();
    if (!['single','ab','dataset','regression'].includes(body.kind)) return fail('执行类型无效');
    return createBatch(client, estimateRoute[1], me, { ...body, dryRun: true }, body.kind);
  }
  const progressRoute = pathname.match(/^\/api\/experiment-batches\/([^/]+)\/progress$/);
  if (progressRoute && method === 'GET') {
    const row = (await client.query(`SELECT b.id,b.status,count(r.id)::int AS total_runs,
      count(r.id) FILTER (WHERE r.status IN ('completed','failed'))::int AS finished_runs,
      count(r.id) FILTER (WHERE r.status='failed')::int AS failed_runs
      FROM experiment_batches b LEFT JOIN experiment_runs r ON r.batch_id=b.id
      WHERE b.id=$1 GROUP BY b.id,b.status`, [progressRoute[1]])).rows[0];
    return row ? ok({ id:row.id,status:row.status,totalRuns:row.total_runs,finishedRuns:row.finished_runs,failedRuns:row.failed_runs }) : fail('批次不存在',404);
  }
  const batchRoute = pathname.match(/^\/api\/experiment-batches\/([^/]+)$/);
  if (batchRoute && method === 'GET') {
    const row = (await client.query('SELECT * FROM experiment_batches WHERE id=$1', [batchRoute[1]])).rows[0];
    if (!row) return fail('批次不存在', 404);
    const runs = (await client.query('SELECT * FROM experiment_runs WHERE batch_id=$1 ORDER BY input_index,created_at', [row.id])).rows.map(mapRun);
    return ok({ id: row.id, experimentId: row.experiment_id, kind: row.kind, status: row.status, inputs: row.inputs, totalRuns: runs.length, finishedRuns: runs.filter(run => ['completed','failed'].includes(run.status)).length, failedRuns: runs.filter(run => run.status === 'failed').length, runs, winRates: winRates(runs) });
  }
  const retryRoute = pathname.match(/^\/api\/experiment-batches\/([^/]+)\/retry$/);
  if (retryRoute && method === 'POST') {
    const batch = (await client.query('SELECT b.*,e.owner_id FROM experiment_batches b JOIN experiments e ON e.id=b.experiment_id WHERE b.id=$1', [retryRoute[1]])).rows[0];
    if (!batch) return fail('批次不存在', 404);
    if (!own(batch, me)) return fail('无权重试', 403);
    if (!await executionConfigured(client)) return fail('模型 API 未配置', 409);
    const count = (await client.query("UPDATE experiment_runs SET status='queued',error=NULL,started_at=NULL,completed_at=NULL WHERE batch_id=$1 AND status='failed' RETURNING id", [batch.id])).rowCount;
    if (!count) return fail('没有失败项可重试', 409);
    await client.query("UPDATE experiment_batches SET status='queued',completed_at=NULL WHERE id=$1", [batch.id]);
    return ok({ queued: count }, 202);
  }
  return null;
}
