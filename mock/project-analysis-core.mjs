import { containsKnownSecret } from './project-scan.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const categoryOrder = { documentation: 0, config: 1, source: 2, test: 3 };

export function projectModuleKey(path) {
  const parts = path.split('/');
  if (parts.length === 1) return '(root)';
  if (['src','app','lib','packages','apps','services'].includes(parts[0]) && parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

export function buildProjectModuleCoverage(files, selectedFiles) {
  const modules = new Map();
  for (const file of files) {
    const moduleKey = projectModuleKey(file.path);
    if (!modules.has(moduleKey)) modules.set(moduleKey, { moduleKey, indexedCount: 0, readCount: 0, selectedCount: 0, truncatedCount: 0, excludedCount: 0, failedCount: 0, unscannedCount: 0 });
    const module = modules.get(moduleKey);
    module.indexedCount++;
    if (file.status === 'read') module.readCount++;
    if (file.status === 'excluded') module.excludedCount++;
    if (file.status === 'failed') module.failedCount++;
    if (file.status === 'unscanned') module.unscannedCount++;
  }
  for (const file of selectedFiles) {
    const module = modules.get(projectModuleKey(file.path));
    if (!module) continue;
    module.selectedCount++;
    if (file.truncated) module.truncatedCount++;
  }
  return [...modules.values()].sort((a,b) => a.moduleKey.localeCompare(b.moduleKey));
}

export function selectProjectEvidence(files, { maxFiles = 30, maxChars = 30000, maxCharsPerFile = 3000 } = {}) {
  const eligible = files.filter(file => file.status === 'read' && typeof file.content === 'string' && !containsKnownSecret(file.content))
    .sort((a, b) => (categoryOrder[a.category] ?? 4) - (categoryOrder[b.category] ?? 4) || a.path.localeCompare(b.path));
  const groups = new Map();
  for (const file of eligible) {
    const key = projectModuleKey(file.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const spread = [];
  for (let index = 0; index < eligible.length; index++) {
    let found = false;
    for (const group of groups.values()) if (group[index]) { spread.push(group[index]); found = true; }
    if (!found) break;
  }
  const selected = [];
  let remaining = maxChars;
  for (const file of spread) {
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
    if (item.status === 'not_found') throw new Error('未发现实现结论不能使用正向代码证据');
    if (!exactKeys(item.evidence, ['path', 'line', 'excerpt'])) throw new Error('模型证据结构无效');
    const file = byPath.get(item.evidence.path);
    const line = item.evidence.line;
    if (!file || !Number.isInteger(line) || line < 1 || line > file.lines.length || !boundedText(item.evidence.excerpt, 500) || file.lines[line - 1].trim() !== item.evidence.excerpt.trim()) throw new Error('模型证据未匹配本次扫描的文件和行号');
    const type = file.category === 'test' ? 'test' : file.category === 'documentation' ? 'document' : 'code';
    if (type === 'document' && ['implemented', 'partial'].includes(item.status)) throw new Error('文档声明不能证明功能已实现');
    return { ...item, evidence: { ...item.evidence, type, gitSha: file.gitSha } };
  });
  const suggestions = value.suggestions.map(item => {
    if (!exactKeys(item, ['topic', 'reason', 'practice', 'acceptance', 'findingIndex']) || !boundedText(item.topic, 160) || !boundedText(item.reason, 1000) || !boundedText(item.practice, 1000) || !boundedText(item.acceptance, 1000) || item.findingIndex !== null && (!Number.isInteger(item.findingIndex) || item.findingIndex < 0 || item.findingIndex >= findings.length)) throw new Error('模型建议结构或关联结论无效');
    return item;
  });
  return { summary: value.summary.trim(), findings, suggestions };
}
