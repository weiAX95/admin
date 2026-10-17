import path from 'node:path';
import { projectModuleKey, selectProjectEvidence } from './project-analysis-core.mjs';

const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const relativeImport = /\b(?:from\s*|import\s*\(|require\s*\()\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;
const sideEffectImport = /\bimport\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;
const rootConfig = /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^/]*)?\.json|vite\.config\.[^/]+|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml)$/;

function importedPaths(file, indexed) {
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file.path) || typeof file.content !== 'string') return [];
  const found = new Set();
  for (const pattern of [relativeImport,sideEffectImport]) {
    pattern.lastIndex = 0;
    let match, count = 0;
    while ((match = pattern.exec(file.content)) && count++ < 200) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file.path),match[1]));
      if (base.startsWith('../') || base.startsWith('/')) continue;
      const target = extensions.map(extension => `${base}${extension}`).find(candidate => indexed.has(candidate));
      if (target) found.add(target);
    }
  }
  return [...found];
}

export function selectProjectImpactEvidence(files, changes) {
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
    const imports = importedPaths(file,indexed);
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
