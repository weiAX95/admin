import path from 'node:path';
import { projectModuleKey, selectProjectEvidence } from './project-analysis-core.mjs';
import { projectApiDependencyEdges } from './project-analysis-api-impact.mjs';

const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const relativeImport = /\b(?:from\s*|import\s*\(|require\s*\()\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;
const sideEffectImport = /\bimport\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;
const namedImport = /\b(?:from\s*|import\s*\(|require\s*\()\s*['"]([^.'"\n/][^'"\n]*)['"]/g;
const namedSideEffectImport = /\bimport\s*['"]([^.'"\n/][^'"\n]*)['"]/g;
const rootConfig = /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^/]*)?\.json|vite\.config\.[^/]+|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml)$/;
const aliasConfigPath = /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/;

function javascriptImports(file, indexed, resolveEmittedNames = false) {
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file.path)) return [];
  const found = new Set();
  for (const pattern of [relativeImport,sideEffectImport]) {
    pattern.lastIndex = 0;
    let match, count = 0;
    while ((match = pattern.exec(file.content)) && count++ < 200) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file.path),match[1]));
      if (base.startsWith('../') || base.startsWith('/')) continue;
      const emitted = resolveEmittedNames ? base.match(/^(.*)\.(js|jsx|mjs|cjs)$/) : null;
      const sourceNames = emitted ? ({ js: ['ts','tsx'], jsx: ['tsx'], mjs: ['mts'], cjs: ['cts'] })[emitted[2]].map(extension => `${emitted[1]}.${extension}`) : [];
      const target = [...extensions.map(extension => `${base}${extension}`),...sourceNames].find(candidate => indexed.has(candidate));
      if (target) found.add(target);
    }
  }
  return [...found];
}

function jsonWithComments(content) {
  let result = '', quoted = false, escaped = false, line = false, block = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i], next = content[i + 1];
    if (line) { if (char === '\n') { line = false; result += char; } continue; }
    if (block) { if (char === '*' && next === '/') { block = false; i++; } else if (char === '\n') result += char; continue; }
    if (quoted) { result += char; if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; result += char; }
    else if (char === '/' && next === '/') { line = true; i++; }
    else if (char === '/' && next === '*') { block = true; i++; }
    else result += char;
  }
  let clean = '', inString = false, slash = false;
  for (let i = 0; i < result.length; i++) {
    const char = result[i];
    if (inString) { clean += char; if (slash) slash = false; else if (char === '\\') slash = true; else if (char === '"') inString = false; continue; }
    if (char === '"') { inString = true; clean += char; continue; }
    if (char === ',' && /[}\]]/.test(result.slice(i + 1).match(/^\s*(.)/)?.[1] || '')) continue;
    clean += char;
  }
  return clean;
}

function javascriptAliasConfigs(files, includeExtends = false) {
  if (!includeExtends) return files.filter(file => file.status === 'read' && aliasConfigPath.test(file.path) && typeof file.content === 'string').flatMap(file => {
    try {
      const options = JSON.parse(jsonWithComments(file.content)).compilerOptions;
      if (!options || !options.paths || typeof options.paths !== 'object' || Array.isArray(options.paths)) return [];
      const directory = path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path);
      const base = path.posix.normalize(path.posix.join(directory,typeof options.baseUrl === 'string' ? options.baseUrl : '.'));
      const paths = Object.entries(options.paths).filter(([key,values]) => key.split('*').length <= 2 && Array.isArray(values)).map(([key,values]) => ({ key, base, values: values.filter(value => typeof value === 'string' && value.split('*').length <= 2) }));
      return [{ directory, base, paths }];
    } catch { return []; }
  }).sort((a,b) => b.directory.length - a.directory.length);
  const readable = new Map(files.filter(file => file.status === 'read' && typeof file.content === 'string').map(file => [file.path,file.content]));
  const parsed = new Map();
  const parse = (name, visiting = new Set()) => {
    if (parsed.has(name)) return parsed.get(name);
    if (!readable.has(name) || visiting.has(name) || visiting.size >= 12) return null;
    visiting.add(name);
    let result = null;
    try {
      const raw = JSON.parse(jsonWithComments(readable.get(name)));
      const directory = path.posix.dirname(name) === '.' ? '' : path.posix.dirname(name);
      const parents = Array.isArray(raw.extends) ? raw.extends : [raw.extends];
      let inherited = null;
      for (const reference of parents) {
        if (typeof reference !== 'string' || !reference.startsWith('.')) continue;
        const base = path.posix.normalize(path.posix.join(directory,reference));
        if (base.startsWith('../') || base.startsWith('/')) continue;
        const parent = [base,`${base}.json`,`${base}/tsconfig.json`].find(candidate => readable.has(candidate));
        if (parent) {
          const resolved = parse(parent,visiting);
          if (resolved) inherited = { base: resolved.base || inherited?.base, paths: resolved.paths.length ? resolved.paths : inherited?.paths || [] };
        }
      }
      const options = raw.compilerOptions || {};
      const base = typeof options.baseUrl === 'string' ? path.posix.normalize(path.posix.join(directory,options.baseUrl)) : inherited?.base || directory || '.';
      const ownPaths = options.paths;
      const paths = ownPaths && typeof ownPaths === 'object' && !Array.isArray(ownPaths)
        ? Object.entries(ownPaths).filter(([key,values]) => key.split('*').length <= 2 && Array.isArray(values)).map(([key,values]) => ({ key, base, values: values.filter(value => typeof value === 'string' && value.split('*').length <= 2) }))
        : inherited?.paths || [];
      result = { directory, base, paths };
    } catch { /* Invalid or unavailable configs supply no alias evidence. */ }
    visiting.delete(name);
    parsed.set(name,result);
    return result;
  };
  return [...readable.keys()].filter(name => aliasConfigPath.test(name)).map(name => parse(name)).filter(config => config?.paths.length).sort((a,b) => b.directory.length - a.directory.length);
}

function javascriptAliasedImports(file, indexed, aliasConfigs, includeSameDepth = false) {
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file.path)) return [];
  const candidates = aliasConfigs.filter(item => !item.directory || file.path.startsWith(`${item.directory}/`));
  if (!candidates.length) return [];
  const configs = includeSameDepth ? candidates.filter(item => item.directory.length === candidates[0].directory.length) : candidates.slice(0,1);
  const found = new Set();
  for (const pattern of [namedImport,namedSideEffectImport]) {
    pattern.lastIndex = 0;
    let match, count = 0;
    while ((match = pattern.exec(file.content)) && count++ < 200) {
      for (const mapping of configs.flatMap(item => item.paths)) {
        const star = mapping.key.indexOf('*');
        const prefix = star < 0 ? mapping.key : mapping.key.slice(0,star);
        const suffix = star < 0 ? '' : mapping.key.slice(star + 1);
        if (star < 0 ? match[1] !== mapping.key : !match[1].startsWith(prefix) || !match[1].endsWith(suffix)) continue;
        const captured = star < 0 ? '' : match[1].slice(prefix.length,match[1].length - suffix.length);
        for (const value of mapping.values) {
          const targetBase = path.posix.normalize(path.posix.join(mapping.base,value.replace('*',captured)));
          if (targetBase.startsWith('../') || targetBase.startsWith('/')) continue;
          const emitted = targetBase.match(/^(.*)\.(js|jsx|mjs|cjs)$/);
          const sourceNames = emitted ? ({ js: ['ts','tsx'], jsx: ['tsx'], mjs: ['mts'], cjs: ['cts'] })[emitted[2]].map(extension => `${emitted[1]}.${extension}`) : [];
          const target = [...extensions.map(extension => `${targetBase}${extension}`),...sourceNames].find(candidate => indexed.has(candidate));
          if (target) found.add(target);
        }
      }
    }
  }
  return [...found];
}

function pythonTargets(file, moduleName, indexed) {
  const dots = moduleName.match(/^\.+/)?.[0].length || 0;
  const name = moduleName.slice(dots).replaceAll('.', '/');
  const parent = dots ? path.posix.join(path.posix.dirname(file.path),...Array(dots - 1).fill('..')) : '';
  const base = path.posix.normalize(path.posix.join(parent,name));
  if (!base || base === '.' || base.startsWith('../') || base.startsWith('/')) return [];
  return [`${base}.py`,`${base}/__init__.py`].filter(candidate => indexed.has(candidate));
}

function pythonImports(file, indexed) {
  if (!file.path.endsWith('.py')) return [];
  const found = new Set();
  const pattern = /^\s*(?:from\s+([.\w]+)\s+import\s+([^#\n]+)|import\s+([^#\n]+))/gm;
  let match, count = 0;
  while ((match = pattern.exec(file.content)) && count++ < 200) {
    if (match[1]) {
      for (const target of pythonTargets(file,match[1],indexed)) found.add(target);
      for (const name of match[2].split(',')) {
        const imported = name.trim().split(/\s+as\s+/)[0];
        if (/^[A-Za-z_]\w*$/.test(imported)) for (const target of pythonTargets(file,`${match[1]}${match[1].endsWith('.') ? '' : '.'}${imported}`,indexed)) found.add(target);
      }
    } else for (const name of match[3].split(',')) {
      const imported = name.trim().split(/\s+as\s+/)[0];
      if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(imported)) for (const target of pythonTargets(file,imported,indexed)) found.add(target);
    }
  }
  return [...found];
}

function goImports(file, indexed, goModules) {
  if (!file.path.endsWith('.go')) return [];
  const module = goModules.find(item => !item.directory || file.path.startsWith(`${item.directory}/`));
  const found = new Set([...indexed].filter(target => target !== file.path && target.endsWith('.go') && path.posix.dirname(target) === path.posix.dirname(file.path)));
  if (!module) return [...found];
  const imported = [];
  const direct = /^\s*import\s+(?:[\w.]+\s+)?["`]([^"`]+)["`]/gm;
  let match;
  while ((match = direct.exec(file.content))) imported.push(match[1]);
  const blocks = /\bimport\s*\(([^)]*)\)/g;
  while ((match = blocks.exec(file.content))) for (const line of match[1].split('\n')) {
    const name = line.match(/^\s*(?:[\w.]+\s+)?["`]([^"`]+)["`]/)?.[1];
    if (name) imported.push(name);
  }
  for (const name of imported.slice(0,200)) {
    if (name !== module.name && !name.startsWith(`${module.name}/`)) continue;
    const suffix = name.slice(module.name.length).replace(/^\//,'');
    const directory = path.posix.join(module.directory,suffix);
    for (const target of indexed) if (target.endsWith('.go') && path.posix.dirname(target) === directory) found.add(target);
  }
  return [...found];
}

function importedPaths(file, indexed, goModules, aliasConfigs = [], includeSameDepth = false) {
  if (typeof file.content !== 'string') return [];
  return [...new Set([...javascriptImports(file,indexed,true),...javascriptAliasedImports(file,indexed,aliasConfigs,includeSameDepth),...pythonImports(file,indexed),...goImports(file,indexed,goModules)])];
}

export function selectProjectImpactEvidenceV3(files, changes) {
  const current = new Map(files.map(file => [file.path,file]));
  const changedPaths = new Set();
  const currentChanged = new Set();
  const impactedModules = new Set();
  for (const change of changes) {
    changedPaths.add(change.path);
    impactedModules.add(projectModuleKey(change.path));
    if (change.kind !== 'deleted') currentChanged.add(change.path);
    if (change.oldPath) {
      changedPaths.add(change.oldPath);
      impactedModules.add(projectModuleKey(change.oldPath));
    }
  }
  const indexed = new Set([...current.keys(),...changedPaths]);
  const related = new Set();
  for (const file of files) {
    if (file.status !== 'read') continue;
    const imports = typeof file.content === 'string' ? javascriptImports(file,indexed) : [];
    if (imports.some(target => changedPaths.has(target))) {
      related.add(file.path);
      impactedModules.add(projectModuleKey(file.path));
    }
    if (changedPaths.has(file.path)) for (const target of imports) {
      if (current.has(target)) related.add(target);
      impactedModules.add(projectModuleKey(target));
    }
  }
  if (changes.some(change => rootConfig.test(change.path) || change.oldPath && rootConfig.test(change.oldPath))) for (const file of files) impactedModules.add(projectModuleKey(file.path));
  const priorityPaths = [...currentChanged].sort().concat([...related].filter(value => !currentChanged.has(value)).sort());
  return { selected: selectProjectEvidence(files,{ priorityPaths }), impactedModules };
}

function selectImpactEvidence(files, changes, includeApiRoutes, includeAliases = false, includeExtends = false) {
  const current = new Map(files.map(file => [file.path,file]));
  const changedPaths = new Set();
  const currentChanged = new Set();
  const impactedModules = new Set();
  for (const change of changes) {
    changedPaths.add(change.path);
    impactedModules.add(projectModuleKey(change.path));
    if (change.kind !== 'deleted') currentChanged.add(change.path);
    if (change.oldPath) {
      changedPaths.add(change.oldPath);
      impactedModules.add(projectModuleKey(change.oldPath));
    }
  }
  const indexed = new Set([...current.keys(),...changedPaths]);
  const goModules = files.filter(file => file.path.endsWith('go.mod') && file.status === 'read' && typeof file.content === 'string').map(file => ({ directory: path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path), name: file.content.match(/^module\s+([^\s]+)\s*$/m)?.[1] })).filter(item => item.name).sort((a,b) => b.directory.length - a.directory.length);
  const apiEdges = includeApiRoutes ? projectApiDependencyEdges(files) : new Map();
  const aliasConfigs = includeAliases ? javascriptAliasConfigs(files,includeExtends) : [];
  const reverse = new Map();
  const importsByPath = new Map();
  for (const file of files) {
    if (file.status !== 'read') continue;
    const imports = [...new Set([...importedPaths(file,indexed,goModules,aliasConfigs,includeExtends),...(apiEdges.get(file.path) || [])])];
    importsByPath.set(file.path,imports);
    for (const target of imports) {
      if (!reverse.has(target)) reverse.set(target,new Set());
      reverse.get(target).add(file.path);
    }
  }
  const layers = [];
  const visited = new Set(changedPaths);
  let frontier = [...changedPaths];
  while (frontier.length) {
    const next = new Set();
    for (const target of frontier) for (const source of reverse.get(target) || []) if (!visited.has(source)) {
      visited.add(source);
      next.add(source);
      impactedModules.add(projectModuleKey(source));
    }
    if (next.size) layers.push([...next].sort());
    frontier = [...next];
  }
  const dependencies = new Set();
  for (const changed of currentChanged) for (const target of importsByPath.get(changed) || []) if (current.has(target) && !visited.has(target)) {
    dependencies.add(target);
    impactedModules.add(projectModuleKey(target));
  }
  if (changes.some(change => rootConfig.test(change.path) || change.oldPath && rootConfig.test(change.oldPath) || includeAliases && (aliasConfigPath.test(change.path) || change.oldPath && aliasConfigPath.test(change.oldPath)))) for (const file of files) impactedModules.add(projectModuleKey(file.path));
  const priorityPaths = [...currentChanged].sort().concat(...layers,[...dependencies].sort());
  return { selected: selectProjectEvidence(files,{ priorityPaths }), impactedModules };
}

export const selectProjectImpactEvidence = (files, changes) => selectImpactEvidence(files,changes,false);
export const selectProjectImpactEvidenceV5 = (files, changes) => selectImpactEvidence(files,changes,true);
export const selectProjectImpactEvidenceV6 = (files, changes) => selectImpactEvidence(files,changes,true,true);
export const selectProjectImpactEvidenceV7 = (files, changes) => selectImpactEvidence(files,changes,true,true,true);
