import { decodeCsv, parseCsv } from './taskCsv';
import type { DatasetCase } from '../api/experiment-evaluation';

export type EvaluationField = 'caseKey' | 'input' | 'expectedOutput' | 'context' | 'tags' | 'difficulty' | 'source' | 'category' | 'variables' | 'expectedTools';
export const EVALUATION_FIELDS: EvaluationField[] = ['caseKey', 'input', 'expectedOutput', 'context', 'tags', 'difficulty', 'source', 'category', 'variables', 'expectedTools'];
const aliases: Record<string, EvaluationField> = { id: 'caseKey', 用例id: 'caseKey', 用例编号: 'caseKey', 输入: 'input', 用户消息: 'input', 参考答案: 'expectedOutput', 标准答案: 'expectedOutput', 上下文: 'context', 标签: 'tags', 难度: 'difficulty', 来源: 'source', 分类: 'category', 变量: 'variables', 预期工具: 'expectedTools' };
export interface EvaluationImportRow { rowNumber: number; data: DatasetCase; errors: string[] }
export interface EvaluationImportSource { headers: string[]; rows: { rowNumber: number; cells: string[] }[]; mapping: (EvaluationField | '')[]; encoding?: string }

export function mapEvaluationHeaders(headers: string[]) {
  return headers.map(header => {
    const normalized = header.trim().replace(/[\s_-]/g, '').toLowerCase();
    return aliases[normalized] || EVALUATION_FIELDS.find(field => field.toLowerCase() === normalized) || '';
  });
}

export function parseEvaluationFile(bytes: ArrayBuffer, filename: string, encoding: 'auto' | 'utf-8' | 'gbk' = 'auto'): EvaluationImportSource {
  const decoded = decodeCsv(bytes, encoding);
  if (filename.toLowerCase().endsWith('.jsonl')) {
    const entries = decoded.text.split(/\r?\n/).map((line, index) => ({ line, rowNumber: index + 1 })).filter(item => item.line.trim());
    const headers = [...EVALUATION_FIELDS];
    return { headers, mapping: [...EVALUATION_FIELDS], encoding: decoded.encoding, rows: entries.map(item => {
      try {
        const parsed = JSON.parse(item.line) as Record<string, unknown>;
        return { rowNumber: item.rowNumber, cells: headers.map(field => parsed[field] === undefined ? '' : typeof parsed[field] === 'string' ? parsed[field] as string : JSON.stringify(parsed[field])) };
      } catch { return { rowNumber: item.rowNumber, cells: ['#INVALID_JSONL#'] }; }
    }) };
  }
  const parsed = parseCsv(decoded.text);
  return { ...parsed, mapping: mapEvaluationHeaders(parsed.headers), encoding: decoded.encoding };
}

export function previewEvaluationRows(source: EvaluationImportSource): EvaluationImportRow[] {
  const duplicate = new Set<string>();
  return source.rows.map(row => {
    const data: Record<string, unknown> = {}; const errors: string[] = [];
    if (row.cells[0] === '#INVALID_JSONL#') errors.push('JSONL 格式无效');
    source.mapping.forEach((field, index) => {
      if (!field) return;
      const raw = row.cells[index] || '';
      if (!raw.trim()) return;
      try {
        data[field] = ['context', 'tags', 'variables', 'expectedTools'].includes(field) || (['input', 'expectedOutput'].includes(field) && /^[[{]/.test(raw.trim())) ? JSON.parse(raw) : field === 'difficulty' ? Number(raw) : raw;
      } catch { errors.push(`${field} 格式无效`); }
    });
    if (!String(data.caseKey || '').trim()) errors.push('缺少 caseKey');
    if (!data.input && !data.variables) errors.push('缺少 input');
    if (data.difficulty !== undefined && (!Number.isInteger(data.difficulty) || Number(data.difficulty) < 1 || Number(data.difficulty) > 5)) errors.push('难度须为 1–5');
    const key = String(data.caseKey || '').trim();
    if (key && duplicate.has(key)) errors.push('caseKey 重复');
    duplicate.add(key);
    return { rowNumber: row.rowNumber, data: data as unknown as DatasetCase, errors };
  });
}
