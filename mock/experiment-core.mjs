import crypto from 'node:crypto';

export const EXPERIMENT_TEMPLATES = [
  { id: 'prompt-comparison', name: '提示词对比', systemPrompt: '你是严谨的助手。', userPrompt: '请回答：{{question}}', variants: [{ label: '基础提示', parameters: { temperature: 0.2 } }, { label: '开放提示', parameters: { temperature: 0.7 } }] },
  { id: 'model-selection', name: '模型选型', systemPrompt: '请准确且简洁地回答。', userPrompt: '{{question}}', variants: [{ label: '模型 A', parameters: { temperature: 0.2 } }, { label: '模型 B', parameters: { temperature: 0.2 } }] },
  { id: 'parameter-sensitivity', name: '参数敏感性分析', systemPrompt: '完成用户任务。', userPrompt: '{{task}}', variants: [{ label: '保守', parameters: { temperature: 0.1, top_p: 0.7 } }, { label: '开放', parameters: { temperature: 0.9, top_p: 1 } }] },
  { id: 'few-shot', name: 'Few-shot 数量影响', systemPrompt: '参考示例回答问题。', userPrompt: '示例：{{examples}}\n问题：{{question}}', variants: [{ label: '少样本', parameters: { temperature: 0.2 } }, { label: '多样本', parameters: { temperature: 0.2 } }] },
  { id: 'temperature', name: '温度对比', systemPrompt: '完成用户任务。', userPrompt: '{{task}}', variants: [{ label: '低温', parameters: { temperature: 0 } }, { label: '中温', parameters: { temperature: 0.5 } }, { label: '高温', parameters: { temperature: 1 } }] },
];

const ranges = { temperature: [0, 2], top_p: [0, 1], max_tokens: [1, 32768], frequency_penalty: [-2, 2], presence_penalty: [-2, 2] };
export function validateParameters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数必须是对象');
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'stop_sequences') {
      if (!Array.isArray(raw) || raw.length > 8 || raw.some(item => typeof item !== 'string' || !item || item.length > 100)) throw new Error('stop_sequences 无效');
      result[key] = raw;
    } else {
      const range = ranges[key];
      if (!range || typeof raw !== 'number' || !Number.isFinite(raw) || raw < range[0] || raw > range[1] || (key === 'max_tokens' && !Number.isInteger(raw))) throw new Error(`${key} 参数无效`);
      result[key] = raw;
    }
  }
  return result;
}

export function variableNames(prompt) {
  return [...new Set([...String(prompt).matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g)].map(match => match[1]))];
}
export function fillPrompt(prompt, variables) {
  const missing = variableNames(prompt).filter(name => typeof variables?.[name] !== 'string' || !variables[name].trim());
  if (missing.length) throw new Error(`变量未填写：${missing.join('、')}`);
  return String(prompt).replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, name) => variables[name]);
}
export function validateDefinition(body, modelIds) {
  if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) throw new Error('实验标题不能为空且不能超过 200 字符');
  if (typeof body.systemPrompt !== 'string' || typeof body.userPrompt !== 'string') throw new Error('提示词必须是文本');
  if (body.variables === null || typeof body.variables !== 'object' || Array.isArray(body.variables) || Object.values(body.variables).some(value => typeof value !== 'string')) throw new Error('变量必须是字符串映射');
  if (!Array.isArray(body.variants) || body.variants.length < 1 || body.variants.length > 20) throw new Error('请选择 1–20 个模型／参数变体');
  return { title: body.title.trim(), taskId: body.taskId || null, systemPrompt: body.systemPrompt, userPrompt: body.userPrompt, promptVersionId: body.promptVersionId || null, variables: body.variables, variants: body.variants.map((variant, index) => {
    if (!modelIds.has(variant.modelId)) throw new Error(`第 ${index + 1} 个变体的模型不可用`);
    return { id: crypto.randomUUID(), modelId: variant.modelId, label: String(variant.label || `变体 ${index + 1}`).slice(0, 80), parameters: validateParameters(variant.parameters || {}), position: index };
  }) };
}
export function estimateMaxCost(variants, inputs, models) {
  return variants.reduce((total, variant) => {
    const model = models.get(variant.modelId);
    const maxTokens = variant.parameters.max_tokens || 1024;
    return total + inputs.length * ((maxTokens * model.input_usd_per_million + maxTokens * model.output_usd_per_million) / 1_000_000);
  }, 0);
}

export function winRates(runs) {
  const groups = new Map();
  const variants = new Set();
  for (const run of runs) {
    variants.add(run.variantId);
    if (!groups.has(run.inputIndex)) groups.set(run.inputIndex, []);
    groups.get(run.inputIndex).push(run);
  }
  const wins = new Map(); let included = 0; let excluded = 0;
  for (const group of groups.values()) {
    if (group.some(run => run.status !== 'completed' || typeof run.autoScore !== 'number')) { excluded++; continue; }
    included++;
    const best = Math.max(...group.map(run => run.autoScore));
    for (const run of group) if (run.autoScore === best) wins.set(run.variantId, (wins.get(run.variantId) || 0) + 1);
  }
  return { included, excluded, variants: [...variants].map(variantId => ({ variantId, wins: wins.get(variantId) || 0, rate: included ? (wins.get(variantId) || 0) / included : 0 })) };
}
