import crypto from 'node:crypto';

const mediaTypes = new Set(['image', 'audio', 'video']);
const sources = new Set(['manual', 'session_extract', 'qa_import']);

function payload(value, label, allowEmpty = false) {
  const parts = typeof value === 'string' ? [{ type: 'text', text: value }] : value?.parts;
  if (!Array.isArray(parts) || (!allowEmpty && !parts.length) || parts.length > 100) throw new Error(`${label}须为文本或有序消息片段`);
  for (const part of parts) {
    if (part?.type === 'text') {
      if (typeof part.text !== 'string') throw new Error(`${label}文本片段无效`);
    } else if (mediaTypes.has(part?.type)) {
      if (typeof part.assetId !== 'string' || !part.assetId.trim()) throw new Error(`${label}附件 ID 无效`);
    } else throw new Error(`${label}片段类型无效`);
  }
  return { parts: parts.map(part => part.type === 'text' ? { type: 'text', text: part.text } : { type: part.type, assetId: part.assetId }) };
}

export function validateEvaluationCases(cases) {
  if (!Array.isArray(cases) || !cases.length || cases.length > 10000) throw new Error('数据集版本须含 1–10,000 条用例');
  const keys = new Set();
  return cases.map((item, index) => {
    const label = `第 ${index + 1} 条`; const key = String(item?.caseKey || '').trim();
    if (!key || key.length > 200 || keys.has(key)) throw new Error(`${label}用例 ID 缺失、过长或重复`);
    keys.add(key);
    const variables = item.variables ?? (item.input === undefined ? null : { question: (typeof item.input === 'string' ? item.input : item.input.parts?.filter(part => part.type === 'text').map(part => part.text).join('\n')) || '' });
    if (!variables || typeof variables !== 'object' || Array.isArray(variables) || Object.values(variables).some(value => typeof value !== 'string')) throw new Error(`${label}变量必须是字符串映射`);
    const input = payload(item.input ?? variables.question ?? '', `${label}输入`);
    const expected = item.expectedOutput === undefined ? (item.referenceAnswer === undefined || item.referenceAnswer === null ? null : payload(item.referenceAnswer, `${label}参考答案`, true)) : (item.expectedOutput === null ? null : payload(item.expectedOutput, `${label}参考答案`, true));
    if (item.context !== undefined && !Array.isArray(item.context)) throw new Error(`${label}上下文必须是消息数组`);
    const context = (item.context || []).map((message, i) => {
      if (!['system', 'user', 'assistant', 'tool'].includes(message?.role)) throw new Error(`${label}上下文第 ${i + 1} 条角色无效`);
      return { role: message.role, ...payload(message.parts ? { parts: message.parts } : message.content, `${label}上下文`, true) };
    });
    if (context.length > 50) throw new Error(`${label}上下文最多 50 条`);
    const tags = item.tags ?? [];
    if (!Array.isArray(tags) || tags.length > 30 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 32)) throw new Error(`${label}标签无效`);
    const difficultyScore = item.difficulty === undefined || item.difficulty === null || typeof item.difficulty === 'string' ? null : item.difficulty;
    if (difficultyScore !== null && (!Number.isInteger(difficultyScore) || difficultyScore < 1 || difficultyScore > 5)) throw new Error(`${label}难度须为 1–5`);
    const source = item.source || 'manual';
    if (!sources.has(source)) throw new Error(`${label}来源无效`);
    if (item.expectedTools != null && (!Array.isArray(item.expectedTools) || item.expectedTools.some(tool => typeof tool.name !== 'string' || !tool.name || typeof tool.arguments !== 'object' || tool.arguments === null || Array.isArray(tool.arguments)))) throw new Error(`${label}期望工具调用无效`);
    return { id: crypto.randomUUID(), key, variables, input, expected, context, tags: [...new Set(tags.map(tag => tag.trim()))], difficultyScore, difficulty: typeof item.difficulty === 'string' ? item.difficulty.slice(0, 50) : difficultyScore === null ? null : String(difficultyScore), category: item.category ? String(item.category).slice(0, 50) : null, source, expectedTools: item.expectedTools ?? null, referenceAnswer: typeof item.referenceAnswer === 'string' ? item.referenceAnswer : expected?.parts.every(part => part.type === 'text') ? expected.parts.map(part => part.text).join('\n') : null };
  });
}

export function referencedAssetIds(cases) {
  const ids = new Set();
  const visit = value => { for (const part of value?.parts || []) if (mediaTypes.has(part.type)) ids.add(part.assetId); };
  for (const item of cases) { visit(item.input); visit(item.expected); for (const message of item.context) visit(message); }
  return ids;
}
