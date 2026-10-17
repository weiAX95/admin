import path from 'node:path';
import { projectModuleKey, selectProjectEvidence } from './project-analysis-core.mjs';
import { projectApiDependencyEdges } from './project-analysis-api-impact.mjs';

const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const relativeImport = /\b(?:from\s*|import\s*\(|require\s*\()\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;
const sideEffectImport = /\bimport\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;
const rootConfig = /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^/]*)?\.json|vite\.config\.[^/]+|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml)$/;

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

function importedPaths(file, indexed, goModules) {
  if (typeof file.content !== 'string') return [];
  return [...new Set([...javascriptImports(file,indexed,true),...pythonImports(file,indexed),...goImports(file,indexed,goModules)])];
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

function selectImpactEvidence(files, changes, includeApiRoutes) {
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
  const reverse = new Map();
  const importsByPath = new Map();
  for (const file of files) {
    if (file.status !== 'read') continue;
    const imports = [...new Set([...importedPaths(file,indexed,goModules),...(apiEdges.get(file.path) || [])])];
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
  if (changes.some(change => rootConfig.test(change.path) || change.oldPath && rootConfig.test(change.oldPath))) for (const file of files) impactedModules.add(projectModuleKey(file.path));
  const priorityPaths = [...currentChanged].sort().concat(...layers,[...dependencies].sort());
  return { selected: selectProjectEvidence(files,{ priorityPaths }), impactedModules };
}

export const selectProjectImpactEvidence = (files, changes) => selectImpactEvidence(files,changes,false);
export const selectProjectImpactEvidenceV5 = (files, changes) => selectImpactEvidence(files,changes,true);
