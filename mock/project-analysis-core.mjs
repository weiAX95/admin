import { containsKnownSecret } from './project-scan.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function selectProjectEvidence(files, { maxFiles = 30, maxChars = 30000, maxCharsPerFile = 3000 } = {}) {
  const order = { documentation: 0, config: 1, source: 2, test: 3 };
  const eligible = files.filter(file => file.status === 'read' && typeof file.content === 'string' && !containsKnownSecret(file.content))
    .sort((a, b) => (order[a.category] ?? 4) - (order[b.category] ?? 4) || a.path.localeCompare(b.path));
  const selected = [];
  let remaining = maxChars;
  for (const file of eligible) {
    if (selected.length >= maxFiles || remaining <= 0) break;
    const lines = [];
    let used = 0;
    const sourceLines = file.content.split(/\r?\n/);
    if (sourceLines.at(-1) === '') sourceLines.pop();
    for (const line of sourceLines) {
      const cost = String(lines.length + 1).length + 2 + line.length + (lines.length ? 1 : 0);
      if (used + cost > Math.min(maxCharsPerFile, remaining)) break;
      lines.push(line);
      used += cost;
    }
    if (!lines.length) continue;
    selected.push({ path: file.path, category: file.category, gitSha: String(file.git_sha || file.gitSha).trim(), lines, numberedContent: lines.map((line, index) => `${index + 1}: ${line}`).join('\n'), truncated: lines.length < sourceLines.length });
    remaining -= used;
  }
  return selected;
}

export function validateProjectReport(raw, selectedFiles) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('模型报告不是有效 JSON'); }
  if (!exactKeys(value, ['summary', 'findings', 'suggestions']) || !boundedText(value.summary, 2000) || !Array.isArray(value.findings) || !value.findings.length || value.findings.length > 40 || !Array.isArray(value.suggestions) || value.suggestions.length > 30) throw new Error('模型报告结构无效');
  const byPath = new Map(selectedFiles.map(file => [file.path, file]));
  const findings = value.findings.map(item => {
    if (!exactKeys(item, ['title', 'status', 'detail', 'evidence']) || !boundedText(item.title, 160) || !boundedText(item.detail, 2000) || !['implemented', 'partial', 'not_found', 'unverified'].includes(item.status)) throw new Error('模型结论结构无效');
    if (item.evidence === null) {
      if (['implemented', 'partial'].includes(item.status)) throw new Error('已实现或部分实现结论缺少证据');
      return item;
    }
    if (!exactKeys(item.evidence, ['path', 'line', 'excerpt'])) throw new Error('模型证据结构无效');
    const file = byPath.get(item.evidence.path);
    const line = item.evidence.line;
    if (!file || !Number.isInteger(line) || line < 1 || line > file.lines.length || !boundedText(item.evidence.excerpt, 500) || file.lines[line - 1].trim() !== item.evidence.excerpt.trim()) throw new Error('模型证据未匹配本次扫描的文件和行号');
    const type = file.category === 'test' ? 'test' : file.category === 'documentation' ? 'document' : 'code';
    return { ...item, evidence: { ...item.evidence, type, gitSha: file.gitSha } };
  });
  const suggestions = value.suggestions.map(item => {
    if (!exactKeys(item, ['topic', 'reason', 'practice', 'acceptance', 'findingIndex']) || !boundedText(item.topic, 160) || !boundedText(item.reason, 1000) || !boundedText(item.practice, 1000) || !boundedText(item.acceptance, 1000) || item.findingIndex !== null && (!Number.isInteger(item.findingIndex) || item.findingIndex < 0 || item.findingIndex >= findings.length)) throw new Error('模型建议结构或关联结论无效');
    return item;
  });
  return { summary: value.summary.trim(), findings, suggestions };
}
