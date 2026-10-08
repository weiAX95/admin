import { caseInputFingerprint } from './evaluation-datasets.mjs';

const bounded=value=>Math.max(0,Math.min(1,value));
const fixedMetrics=['exact','token_f1','bleu','rouge_l','tool_selection','parameter_accuracy','bertscore','custom_python'];
function rangeScore(value,range) {
  if(value===null || value===undefined || !range || !Number.isFinite(Number(value)) || range.max<=range.min)return null;
  const scaled=bounded((Number(value)-range.min)/(range.max-range.min));
  return range.higher?scaled:1-scaled;
}
export function normalizedScores(row,goals) {
  const result={ accuracy:rangeScore(row.auto_score,goals.accuracy),latency:rangeScore(row.latency_ms,goals.latency),tokens:rangeScore(row.completion_tokens,goals.tokens) };
  for(const key of fixedMetrics) {
    const value=row.metric_details?.[key];
    result[key]=typeof value==='number' && Number.isFinite(value)?bounded(value):null;
  }
  return result;
}
export function degradedRunMetrics(current,baseline,goals,threshold=0.2) {
  const oldByKey=new Map(baseline.filter(row=>row.status==='completed').map(row=>[row.case_key,row]));
  const result=[];
  for(const row of current) {
    const old=oldByKey.get(row.case_key);
    if(!old || row.status!=='completed' || caseInputFingerprint(row)!==caseInputFingerprint(old))continue;
    const before=normalizedScores(old,goals),after=normalizedScores(row,goals);
    for(const key of Object.keys(before)) {
      if(before[key]===null || after[key]===null)continue;
      const drop=before[key]-after[key];
      if(drop>threshold)result.push({caseKey:row.case_key,metric:key,baseline:Number(before[key].toFixed(3)),current:Number(after[key].toFixed(3)),drop:Number(drop.toFixed(3)),difficulty:row.difficulty||'未分类',category:row.category||'未分类',affectedPassRate:old.passed===true&&row.passed===false});
    }
  }
  return result.sort((a,b)=>b.drop-a.drop||a.caseKey.localeCompare(b.caseKey));
}
