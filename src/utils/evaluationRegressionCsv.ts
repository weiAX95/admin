import type { DegradedMetric } from '../api/experiment-evaluation';
import { downloadBlob } from './noteExport';

const escapeCsv=(value:unknown)=>{let text=String(value??'');if(/^[\s]*[=+\-@]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
const suggestion=(metric:string)=>metric==='latency'?'检查模型响应时间、并发度与网络条件':metric==='tokens'?'检查提示词长度、输出限制和冗余内容':metric==='accuracy'?'核对提示词、参考答案与模型版本':'复核该指标的参考答案、输出及评分规则';
export function downloadDegradedCsv(rows:DegradedMetric[],name='评测退化用例.csv') {
  const columns=['用例 ID','指标','基线归一化分','当前归一化分','下降幅度','难度','分类','影响通过率','回归实验建议'];
  const content=[columns,...rows.map(row=>[row.caseKey,row.metric,row.baseline,row.current,row.drop,row.difficulty,row.category,row.affectedPassRate?'是':'否',suggestion(row.metric)])].map(values=>values.map(escapeCsv).join(',')).join('\r\n');
  downloadBlob(new Blob([`\ufeff${content}`],{type:'text/csv;charset=utf-8'}),name);
}
