const measures = { accuracy: 'auto_score', latency: 'latency_ms', tokens: 'completion_tokens' };
export const DEFAULT_GOAL_RANGES = Object.freeze({ accuracy: { min: 0, max: 5, higher: true }, latency: { min: 0, max: 10000, higher: false }, tokens: { min: 0, max: 4096, higher: false } });
export function validateGoalRanges(value = DEFAULT_GOAL_RANGES) {
  for (const key of Object.keys(measures)) {
    const range = value?.[key];
    if (!range || typeof range.min !== 'number' || typeof range.max !== 'number' || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min || typeof range.higher !== 'boolean') throw new Error(`${key} 目标区间无效`);
  }
  return Object.fromEntries(Object.keys(measures).map(key => [key, { min:value[key].min,max:value[key].max,higher:value[key].higher }]));
}
const clamp = value => Math.max(0,Math.min(1,value));

export function rankModels(rows, goalRanges, weights) {
  const active = Object.entries(weights || {}).filter(([key, weight]) => key in measures && typeof weight === 'number' && Number.isFinite(weight) && weight > 0);
  if (!active.length || Object.values(weights || {}).some(weight => typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0)) throw new Error('至少设置一个有效的非负指标权重');
  const sum = active.reduce((total, [,weight]) => total + weight, 0);
  const grouped = new Map(); let excluded = 0;
  for (const row of rows) {
    const values = active.map(([key, weight]) => {
      const range = goalRanges[key], raw = Number(row[measures[key]]);
      if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min || row[measures[key]] === null || !Number.isFinite(raw)) return null;
      const scaled = clamp((raw - range.min) / (range.max - range.min));
      return (range.higher ? scaled : 1 - scaled) * weight / sum;
    });
    if (values.some(value => value === null)) { excluded++; continue; }
    const id = row.model_id;
    if (!grouped.has(id)) grouped.set(id,{ modelId:id,apiModel:row.api_model,count:0,total:0,accuracy:0,latencyMs:0,outputTokens:0 });
    const item = grouped.get(id);
    item.count++; item.total += values.reduce((a,b) => a+b,0);
    item.accuracy += Number(row.auto_score || 0);
    item.latencyMs += Number(row.latency_ms || 0);
    item.outputTokens += Number(row.completion_tokens || 0);
  }
  const items = [...grouped.values()].map(item => ({ modelId:item.modelId,apiModel:item.apiModel,runCount:item.count,score:item.total/item.count,averageAccuracy:item.accuracy/item.count,averageLatencyMs:item.latencyMs/item.count,averageOutputTokens:item.outputTokens/item.count })).sort((a,b) => b.score - a.score || a.apiModel.localeCompare(b.apiModel));
  return { items, excluded };
}
