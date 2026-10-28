import crypto from 'node:crypto';
import { containsKnownSecret, isSensitiveProjectPath } from './project-scan.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const categoryOrder = { documentation: 0, config: 1, source: 2, test: 3 };
const packageTechnologies = new Map([
  ['react','React'], ['vite','Vite'], ['typescript','TypeScript'], ['next','Next.js'], ['vue','Vue'], ['@angular/core','Angular'],
  ['express','Express'], ['fastify','Fastify'], ['pg','node-postgres'], ['prisma','Prisma'], ['tailwindcss','Tailwind CSS'], ['antd','Ant Design'],
]);
const pythonTechnologies = new Map([['fastapi','FastAPI'], ['django','Django'], ['flask','Flask'], ['torch','PyTorch'], ['pandas','pandas']]);
const goTechnologies = new Map([['github.com/gin-gonic/gin','Gin'], ['gorm.io/gorm','GORM']]);
const rustTechnologies = new Map([['tokio','Tokio'], ['axum','Axum'], ['serde','Serde']]);

export function parseProjectRequirements(content) {
  if (typeof content !== 'string' || !content.trim()) return [];
  const items = [], seen = new Set();
  let fenced = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const explicit = line.match(/^(REQ-[A-Za-z0-9-]{2,32})\s*[:：]\s*(.+)$/i);
    const bullet = line.match(/^(?:[-*]|\d+[.)、])\s+(?:\[[ xX]\]\s*)?(.+)$/);
    const text = (explicit?.[2] || bullet?.[1] || '').trim().replace(/\s+/g,' ');
    if (!text || text.length > 500) continue;
    const id = explicit ? explicit[1].toUpperCase() : `R-${crypto.createHash('sha256').update(text.normalize('NFKC')).digest('hex').slice(0,12).toUpperCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, text });
    if (items.length >= 50) break;
  }
  return items;
}

export function detectProjectTechnologies(files) {
  const found = new Map();
  for (const file of [...files].sort((a,b) => a.path.localeCompare(b.path))) {
    if (file.status !== 'read' || typeof file.content !== 'string' || isSensitiveProjectPath(file.path) || !/(^|\/)(?:package\.json|requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml)$/.test(file.path) || containsKnownSecret(file.content)) continue;
    const lines = file.content.split(/\r?\n/);
    const add = (dependency, name, index) => {
      if (!name || found.has(name) || lines[index].length > 300) return;
      found.set(name,{ name, packageName: dependency, path: file.path, line: index + 1, excerpt: lines[index].trim(), gitSha: String(file.git_sha || file.gitSha).trim() });
    };
    if (/(^|\/)package\.json$/.test(file.path)) {
      let manifest;
      try { manifest = JSON.parse(file.content); } catch { continue; }
      if (!isObject(manifest)) continue;
      const dependencies = { ...(isObject(manifest.dependencies) ? manifest.dependencies : {}), ...(isObject(manifest.devDependencies) ? manifest.devDependencies : {}) };
      for (const [dependency,name] of packageTechnologies) {
        if (typeof dependencies[dependency] !== 'string') continue;
        const literal = JSON.stringify(dependency);
        const matches = lines.flatMap((line,index) => line.length <= 300 && line.includes(literal) && /^\s*"[^"\n]+"\s*:/.test(line) ? [index] : []);
        if (matches.length === 1) add(dependency,name,matches[0]);
      }
    } else if (/(^|\/)requirements\.txt$/.test(file.path)) {
      lines.forEach((line,index) => {
        const match = line.trim().match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*(?:[<>=!~].*)?$/);
        if (match) { const dependency = match[1].toLowerCase().replaceAll('_','-'); add(dependency,pythonTechnologies.get(dependency),index); }
      });
    } else if (/(^|\/)pyproject\.toml$/.test(file.path)) {
      let section = '', inDependencies = false;
      lines.forEach((line,index) => {
        const trimmed = line.trim();
        if (/^\[[^\]]+\]$/.test(trimmed)) { section = trimmed.slice(1,-1); inDependencies = false; return; }
        if (section === 'project') {
          if (/^dependencies\s*=\s*\[$/.test(trimmed)) { inDependencies = true; return; }
          if (inDependencies && /^\]/.test(trimmed)) { inDependencies = false; return; }
          if (!inDependencies) return;
          const match = trimmed.match(/^["']([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?(?:[^"']*)["'],?(?:\s+#.*)?$/);
          if (match) { const dependency = match[1].toLowerCase().replaceAll('_','-'); add(dependency,pythonTechnologies.get(dependency),index); }
        } else if (section === 'tool.poetry.dependencies') {
          const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(?:["'][^"']+["']|\{[^}\n]+\})(?:\s+#.*)?$/);
          if (match) { const dependency = match[1].toLowerCase().replaceAll('_','-'); add(dependency,pythonTechnologies.get(dependency),index); }
        }
      });
    } else if (/(^|\/)go\.mod$/.test(file.path)) {
      let inRequire = false;
      lines.forEach((line,index) => {
        const trimmed = line.trim();
        if (/^require\s+\($/.test(trimmed)) { inRequire = true; return; }
        if (inRequire && trimmed === ')') { inRequire = false; return; }
        const match = inRequire ? trimmed.match(/^([^\s]+)\s+v[^\s]+(?:\s+\/\/.*)?$/) : trimmed.match(/^require\s+([^\s]+)\s+v[^\s]+(?:\s+\/\/.*)?$/);
        if (match) add(match[1],goTechnologies.get(match[1]),index);
      });
    } else if (/(^|\/)Cargo\.toml$/.test(file.path)) {
      let dependencies = false;
      lines.forEach((line,index) => {
        const trimmed = line.trim();
        if (/^\[[^\]]+\]$/.test(trimmed)) { dependencies = /^\[(?:dev-|build-)?dependencies\]$/.test(trimmed); return; }
        if (!dependencies) return;
        const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:"[^"\n]+"|\{[^\n}]+\})(?:\s+#.*)?$/);
        if (match) add(match[1],rustTechnologies.get(match[1]),index);
      });
    }
  }
  return [...found.values()].sort((a,b) => a.name.localeCompare(b.name)).slice(0,30);
}

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

export function selectProjectEvidence(files, { maxFiles = 30, maxChars = 30000, maxCharsPerFile = 3000, maxModules = 8, priorityPaths = [] } = {}) {
  const eligible = files.filter(file => file.status === 'read' && typeof file.content === 'string' && !isSensitiveProjectPath(file.path) && !containsKnownSecret(file.content))
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
  const priority = new Map(priorityPaths.map((value,index) => [value,index]));
  spread.sort((a,b) => {
    const left = priority.get(a.path) ?? Infinity;
    const right = priority.get(b.path) ?? Infinity;
    return left === right ? 0 : left - right;
  });
  const selected = [];
  const selectedModules = new Set();
  let remaining = maxChars;
  for (const file of spread) {
    if (selected.length >= maxFiles || remaining <= 0) break;
    const moduleKey = projectModuleKey(file.path);
    if (!selectedModules.has(moduleKey) && selectedModules.size >= maxModules) continue;
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
    selectedModules.add(moduleKey);
    remaining -= used;
  }
  return selected;
}

export function groupProjectEvidence(selectedFiles) {
  const groups = new Map();
  for (const file of selectedFiles) {
    const moduleKey = projectModuleKey(file.path);
    if (!groups.has(moduleKey)) groups.set(moduleKey, []);
    groups.get(moduleKey).push(file);
  }
  return [...groups].map(([moduleKey,files]) => ({ moduleKey, files }));
}

export function selectCrossModuleEvidence(selectedFiles) {
  const files = [];
  for (const group of groupProjectEvidence(selectedFiles)) {
    for (const file of group.files) {
      if (!['source', 'test'].includes(file.category)) continue;
      const lines = [];
      let length = 0;
      for (const line of file.lines.slice(0, 30)) {
        if (length + line.length + 8 > 1200) break;
        lines.push(line);
        length += line.length + 8;
      }
      if (lines.length) {
        files.push({ ...file, lines, numberedContent: lines.map((line, index) => `${index + 1}: ${line}`).join('\n') });
        break;
      }
    }
  }
  return files;
}

export function validateCrossModuleFlows(raw, selectedFiles) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('跨模块流程不是有效 JSON'); }
  if (!exactKeys(value, ['flows']) || !Array.isArray(value.flows) || value.flows.length > 2) throw new Error('跨模块流程结构无效');
  const byPath = new Map(selectedFiles.map(file => [file.path, file]));
  return value.flows.map(flow => {
    if (!exactKeys(flow, ['title', 'steps']) || !boundedText(flow.title, 160) || !Array.isArray(flow.steps) || flow.steps.length < 2 || flow.steps.length > 5) throw new Error('跨模块流程步骤无效');
    const modules = new Set();
    const steps = flow.steps.map(step => {
      if (!exactKeys(step, ['description', 'evidence']) || !boundedText(step.description, 300) || !exactKeys(step.evidence, ['path', 'line', 'excerpt'])) throw new Error('跨模块流程证据结构无效');
      const file = byPath.get(step.evidence.path);
      const line = step.evidence.line;
      if (!file || !Number.isInteger(line) || line < 1 || line > file.lines.length || !boundedText(step.evidence.excerpt, 500) || file.lines[line - 1].trim() !== step.evidence.excerpt.trim()) throw new Error('跨模块流程证据未匹配本次输入的源码或测试行');
      modules.add(projectModuleKey(file.path));
      return { description: step.description.trim(), evidence: { path: file.path, line, excerpt: step.evidence.excerpt, type: file.category === 'test' ? 'test' : 'code', gitSha: file.gitSha } };
    });
    if (modules.size < 2) throw new Error('跨模块流程须包含至少两个目录模块的证据');
    return { title: flow.title.trim(), moduleKey: null, steps };
  });
}

export function mergeProjectModuleReports(results) {
  const findings = [], suggestions = [], flows = [], semanticDuplicates = [];
  for (const { moduleKey, report } of results) {
    const offset = findings.length;
    const suggestionOffset = suggestions.length;
    findings.push(...report.findings.map(finding => ({ ...finding, moduleKey })));
    suggestions.push(...report.suggestions.map(suggestion => ({ ...suggestion, findingIndex: suggestion.findingIndex === null ? null : offset + suggestion.findingIndex,
      ...(suggestion.dependsOnIndexes ? { dependsOnIndexes: suggestion.dependsOnIndexes.map(index => suggestionOffset + index) } : {}) })));
    semanticDuplicates.push(...(report.semanticDuplicates || []).map(item => ({ ...item, suggestionIndex: suggestionOffset + item.suggestionIndex })));
    flows.push(...(report.flows || []).map(flow => ({ ...flow, moduleKey })));
  }
  if (findings.length > 40 || suggestions.length > 30 || flows.length > 16) throw new Error('模块报告条目超出汇总上限');
  const summary = results.length === 1 ? results[0].report.summary : `已分析 ${results.length} 个目录模块。${results.map(({moduleKey,report}) => `${moduleKey}：${report.summary.slice(0,180)}`).join('；')}`.slice(0,2000);
  return { summary, findings, suggestions, flows, ...(results.some(item => Object.hasOwn(item.report,'semanticDuplicates')) ? { semanticDuplicates } : {}) };
}

export function validateProjectReport(raw, selectedFiles, { maxFindings = 40, maxSuggestions = 30, maxFlows = 2, requirementIds = [], duplicateCandidateTaskIds = null, structuredDependencies = false, sourceRequiredForImplementation = false } = {}) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('模型报告不是有效 JSON'); }
  const legacyShape = exactKeys(value, ['summary', 'findings', 'suggestions']) || exactKeys(value, ['summary', 'findings', 'suggestions', 'flows']);
  const semanticShape = exactKeys(value, ['summary', 'findings', 'suggestions', 'flows', 'semanticDuplicates']);
  if (!(duplicateCandidateTaskIds === null ? legacyShape : semanticShape) || !boundedText(value.summary, 2000) || !Array.isArray(value.findings) || !value.findings.length || value.findings.length > maxFindings || !Array.isArray(value.suggestions) || value.suggestions.length > maxSuggestions || (Object.hasOwn(value, 'flows') && (!Array.isArray(value.flows) || value.flows.length > maxFlows))) throw new Error('模型报告结构无效');
  const byPath = new Map(selectedFiles.map(file => [file.path, file]));
  const findings = value.findings.map(item => {
    if (!exactKeys(item, ['title', 'status', 'detail', 'evidence', 'requirementId']) || !boundedText(item.title, 160) || !boundedText(item.detail, 2000) || !['implemented', 'partial', 'not_found', 'unverified'].includes(item.status) || item.requirementId !== null && (typeof item.requirementId !== 'string' || !requirementIds.includes(item.requirementId))) throw new Error('模型结论结构或需求关联无效');
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
    if (sourceRequiredForImplementation && type !== 'code' && ['implemented', 'partial'].includes(item.status)) {
      const caveat = `（本次仅有${type === 'test' ? '测试源码' : '文档声明'}线索，尚无实现源码或运行结果）`;
      return {
        ...item,
        status: 'unverified',
        detail: `${item.detail.slice(0,2000 - caveat.length)}${caveat}`,
        evidence: { ...item.evidence, type, gitSha: file.gitSha },
      };
    }
    if (type === 'document' && ['implemented', 'partial'].includes(item.status)) throw new Error('文档声明不能证明功能已实现');
    return { ...item, evidence: { ...item.evidence, type, gitSha: file.gitSha } };
  });
  const suggestions = value.suggestions.map((item,index) => {
    const keys = ['topic', 'reason', 'practice', 'acceptance', 'findingIndex', 'impact', 'impactReason', 'prerequisites', ...(structuredDependencies ? ['dependsOnIndexes'] : [])];
    if (!exactKeys(item, keys) || !boundedText(item.topic, 160) || !boundedText(item.reason, 1000) || !boundedText(item.practice, 1000) || !boundedText(item.acceptance, 1000) || !['high','medium','low'].includes(item.impact) || !boundedText(item.impactReason, 1000) || !Array.isArray(item.prerequisites) || item.prerequisites.length > 5 || item.prerequisites.some(value => !boundedText(value, 120)) || new Set(item.prerequisites.map(value => value.trim().toLocaleLowerCase())).size !== item.prerequisites.length || item.findingIndex !== null && (!Number.isInteger(item.findingIndex) || item.findingIndex < 0 || item.findingIndex >= findings.length)
      || structuredDependencies && (!Array.isArray(item.dependsOnIndexes) || item.dependsOnIndexes.length > 3 || new Set(item.dependsOnIndexes).size !== item.dependsOnIndexes.length || item.dependsOnIndexes.some(position => !Number.isInteger(position) || position < 0 || position >= value.suggestions.length || position === index))) throw new Error('模型建议结构或关联结论无效');
    return item;
  });
  const semanticDuplicates = [];
  if (duplicateCandidateTaskIds !== null) {
    if (!Array.isArray(value.semanticDuplicates) || value.semanticDuplicates.length > suggestions.length) throw new Error('模型语义重复候选结构无效');
    const usedSuggestions = new Set();
    for (const item of value.semanticDuplicates) {
      if (!exactKeys(item,['suggestionIndex','taskId','reason']) || !Number.isInteger(item.suggestionIndex) || item.suggestionIndex < 0 || item.suggestionIndex >= suggestions.length
        || usedSuggestions.has(item.suggestionIndex) || !duplicateCandidateTaskIds.has(item.taskId)
        || !boundedText(item.reason,300) || Array.from(item.reason.trim()).length < 10) throw new Error('模型语义重复候选无效');
      usedSuggestions.add(item.suggestionIndex);
      semanticDuplicates.push({ suggestionIndex: item.suggestionIndex, taskId: item.taskId, reason: item.reason.trim() });
    }
  }
  const flows = (value.flows || []).map(flow => {
    if (!exactKeys(flow, ['title', 'steps']) || !boundedText(flow.title, 160) || !Array.isArray(flow.steps) || flow.steps.length < 2 || flow.steps.length > 4) throw new Error('核心流程结构无效');
    return { title: flow.title.trim(), steps: flow.steps.map(step => {
      if (!exactKeys(step, ['description', 'evidence']) || !boundedText(step.description, 300) || !exactKeys(step.evidence, ['path', 'line', 'excerpt'])) throw new Error('核心流程步骤或证据结构无效');
      const file = byPath.get(step.evidence.path);
      const line = step.evidence.line;
      if (!file || !['source', 'test'].includes(file.category) || !Number.isInteger(line) || line < 1 || line > file.lines.length || !boundedText(step.evidence.excerpt, 500) || file.lines[line - 1].trim() !== step.evidence.excerpt.trim()) throw new Error('核心流程步骤缺少本次扫描的代码或测试行证据');
      return { description: step.description.trim(), evidence: { path: file.path, line, excerpt: step.evidence.excerpt, type: file.category === 'test' ? 'test' : 'code', gitSha: file.gitSha } };
    }) };
  });
  return { summary: value.summary.trim(), findings, suggestions, flows, ...(duplicateCandidateTaskIds !== null ? { semanticDuplicates } : {}) };
}
