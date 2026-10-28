import path from 'node:path';
import { projectModuleKey, selectProjectEvidence } from './project-analysis-core.mjs';
import { dynamicApiFiles, projectApiDependencyEdges } from './project-analysis-api-impact.mjs';
import { changedSqlNeedsBroadReview, dynamicSqlFiles, projectSqlDependencyEdges } from './project-analysis-sql-impact.mjs';

const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const relativeImport = /\b(?:from\s*|import\s*\(|require\s*\()\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;
const sideEffectImport = /\bimport\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;
const namedImport = /\b(?:from\s*|import\s*\(|require\s*\()\s*['"]([^.'"\n/][^'"\n]*)['"]/g;
const namedSideEffectImport = /\bimport\s*['"]([^.'"\n/][^'"\n]*)['"]/g;
const rootConfig = /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[^/]*)?\.json|vite\.config\.[^/]+|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml)$/;
const aliasConfigPath = /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/;
const viteConfigPath = /(?:^|\/)vite\.config\.(?:[cm]?[jt]s)$/;
const nestedConfigPath = /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json|vite\.config\.[^/]+|pyproject\.toml|requirements\.txt|go\.(?:mod|work)|Cargo\.toml)$/;

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

// Only a direct literal Vite config is evidence: do not execute repository code or
// infer aliases from variables, spreads, functions, regexes, or computed properties.
function viteTokens(content) {
  if (content.length > 100_000) return null;
  const tokens = [];
  for (let index = 0; index < content.length;) {
    const char = content[index], next = content[index + 1];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '/' && next === '/') { index = content.indexOf('\n',index + 2); if (index < 0) break; continue; }
    if (char === '/' && next === '*') { index = content.indexOf('*/',index + 2); if (index < 0) return null; index += 2; continue; }
    if (char === '/' || char === '`') return null;
    if (char === '"' || char === "'") {
      const quote = char;
      let end = index + 1;
      while (end < content.length && content[end] !== quote) {
        if (content[end] === '\\') end++;
        end++;
      }
      if (end >= content.length) return null;
      tokens.push({ type: 'string', value: content.slice(index + 1,end) });
      index = end + 1;
    } else if (/[A-Za-z_$]/.test(char)) {
      let end = index + 1;
      while (end < content.length && /[\w$]/.test(content[end])) end++;
      tokens.push({ type: 'identifier', value: content.slice(index,end) });
      index = end;
    } else {
      const value = content.startsWith('...',index) ? '...' : char;
      tokens.push({ type: 'punctuation', value });
      index += value.length;
    }
    if (tokens.length > 12_000) return null;
  }
  return tokens;
}

function literalSegments(tokens, start, end, opening, closing) {
  if (tokens[start]?.value !== opening || tokens[end]?.value !== closing) return null;
  const matching = { '}': '{', ']': '[', ')': '(' };
  const stack = [];
  const segments = [];
  let first = start + 1;
  for (let index = first; index < end; index++) {
    const value = tokens[index].value;
    if (value === '{' || value === '[' || value === '(') stack.push(value);
    else if (Object.hasOwn(matching,value)) { if (stack.pop() !== matching[value]) return null; }
    else if (value === ',' && !stack.length) {
      if (first < index) segments.push(tokens.slice(first,index));
      first = index + 1;
    }
  }
  if (stack.length) return null;
  if (first < end) segments.push(tokens.slice(first,end));
  return segments;
}

function literalProperties(tokens) {
  const segments = literalSegments(tokens,0,tokens.length - 1,'{','}');
  if (!segments) return null;
  const properties = new Map();
  for (const segment of segments) {
    const key = segment[0];
    if (!key || !['identifier','string'].includes(key.type) || segment[1]?.value !== ':' || segment.length < 3 || properties.has(key.value)) return null;
    properties.set(key.value,segment.slice(2));
  }
  return properties;
}

function literalString(tokens) {
  return tokens?.length === 1 && tokens[0].type === 'string' && !tokens[0].value.includes('\\') ? tokens[0].value : null;
}

function literalViteAliases(tokens) {
  const root = literalProperties(tokens);
  if (!root) return null;
  const resolve = root.get('resolve');
  if (!resolve) return [];
  const options = literalProperties(resolve);
  if (!options) return null;
  const alias = options.get('alias');
  if (!alias) return [];
  let entries;
  if (alias[0]?.value === '{') {
    const properties = literalProperties(alias);
    if (!properties) return null;
    entries = [...properties].map(([find,value]) => ({ find, replacement: literalString(value) }));
  } else {
    const items = literalSegments(alias,0,alias.length - 1,'[',']');
    if (!items) return null;
    entries = items.map(item => {
      const properties = literalProperties(item);
      if (!properties || properties.size !== 2 || !properties.has('find') || !properties.has('replacement')) return null;
      return { find: literalString(properties.get('find')), replacement: literalString(properties.get('replacement')) };
    });
  }
  if (entries.some(item => !item?.find || item.find.includes('\\') || !item.replacement)) return null;
  return entries;
}

function viteAliasConfig(content) {
  const tokens = viteTokens(content);
  if (!tokens) return null;
  const roots = [];
  for (let index = 0; index < tokens.length; index++) {
    const exported = tokens[index]?.type === 'identifier' && tokens[index].value === 'export' && tokens[index + 1]?.type === 'identifier' && tokens[index + 1].value === 'default';
    const commonjs = tokens[index]?.type === 'identifier' && tokens[index].value === 'module' && tokens[index + 1]?.value === '.' && tokens[index + 2]?.type === 'identifier' && tokens[index + 2].value === 'exports' && tokens[index + 3]?.value === '=';
    if (!exported && !commonjs) continue;
    const value = exported ? index + 2 : index + 4;
    const opening = tokens[value]?.type === 'identifier' && tokens[value].value === 'defineConfig' && tokens[value + 1]?.value === '(' ? value + 2 : value;
    if (tokens[opening]?.value !== '{') return null;
    const stack = [];
    let closing = -1;
    for (let cursor = opening; cursor < tokens.length; cursor++) {
      const token = tokens[cursor].value;
      if (token === '{') stack.push(token);
      else if (token === '}') { if (stack.pop() !== '{') return null; if (!stack.length) { closing = cursor; break; } }
    }
    if (closing < 0 || opening !== value && tokens[closing + 1]?.value !== ')') return null;
    const after = opening === value ? closing + 1 : closing + 2;
    if (tokens[after] && tokens[after].value !== ';') return null;
    roots.push(tokens.slice(opening,closing + 1));
  }
  return roots.length === 1 ? literalViteAliases(roots[0]) : null;
}

function viteAliasConfigs(files) {
  return files.filter(file => viteConfigPath.test(file.path)).map(file => ({
    directory: path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path),
    aliases: file.status === 'read' && typeof file.content === 'string' ? viteAliasConfig(file.content) : null,
  })).sort((a,b) => b.directory.length - a.directory.length);
}

function javascriptSourceTokens(content) {
  if (content.length > 262_144) return null;
  const tokens = [];
  const quoted = start => {
    let end = start + 1;
    while (end < content.length && content[end] !== content[start]) {
      if (content[end] === '\\') end++;
      end++;
    }
    return end < content.length ? end + 1 : null;
  };
  const template = (start, nesting = 0) => {
    if (nesting >= 32) return null;
    let index = start + 1;
    while (index < content.length) {
      if (content[index] === '\\') { index += 2; continue; }
      if (content[index] === '`') return index + 1;
      if (content[index] === '$' && content[index + 1] === '{') {
        let depth = 1;
        index += 2;
        while (index < content.length && depth) {
          if (content[index] === '"' || content[index] === "'") { index = quoted(index); if (index === null) return null; continue; }
          if (content[index] === '`') { index = template(index,nesting + 1); if (index === null) return null; continue; }
          if (content[index] === '/' && content[index + 1] === '/') { index = content.indexOf('\n',index + 2); if (index < 0) return null; continue; }
          if (content[index] === '/' && content[index + 1] === '*') { index = content.indexOf('*/',index + 2); if (index < 0) return null; index += 2; continue; }
          if (content[index] === '/') return null;
          if (content[index] === '{') depth++;
          else if (content[index] === '}') depth--;
          index++;
        }
        if (depth) return null;
        continue;
      }
      index++;
    }
    return null;
  };
  for (let index = 0; index < content.length;) {
    const char = content[index], next = content[index + 1];
    if (/\s/.test(char)) { index++; continue; }
    if (char === '/' && next === '/') { index = content.indexOf('\n',index + 2); if (index < 0) break; continue; }
    if (char === '/' && next === '*') { index = content.indexOf('*/',index + 2); if (index < 0) return null; index += 2; continue; }
    if (char === '"' || char === "'") {
      const end = quoted(index);
      if (end === null) return null;
      tokens.push({ type: 'string', value: content.slice(index + 1,end - 1) });
      index = end;
    } else if (char === '`') {
      index = template(index);
      if (index === null) return null;
    } else if (char === '/' && (/^(?:=|\(|\[|\{|:|,|!|\?|return|case)$/.test(tokens.at(-1)?.value || '') || tokens.at(-1)?.value === '>' && tokens.at(-2)?.value === '=')) {
      let end = index + 1, characterClass = false;
      while (end < content.length) {
        if (content[end] === '\\') { end += 2; continue; }
        if (content[end] === '[') characterClass = true;
        else if (content[end] === ']') characterClass = false;
        else if (content[end] === '/' && !characterClass) break;
        end++;
      }
      if (end >= content.length) return null;
      index = end + 1;
      while (/[A-Za-z]/.test(content[index] || '')) index++;
    } else if (/[A-Za-z_$]/.test(char)) {
      let end = index + 1;
      while (end < content.length && /[\w$]/.test(content[end])) end++;
      tokens.push({ type: 'identifier', value: content.slice(index,end) });
      index = end;
    } else {
      tokens.push({ type: 'punctuation', value: char });
      index++;
    }
    if (tokens.length > 20_000) return null;
  }
  return tokens;
}

function literalImportNames(tokens) {
  const names = [];
  const afterBindings = (start, allowDefault) => {
    let cursor = start;
    if (tokens[cursor]?.value === 'type') cursor++;
    if (allowDefault && tokens[cursor]?.type === 'identifier') {
      cursor++;
      if (tokens[cursor]?.value === ',') cursor++;
      else return cursor;
    }
    if (tokens[cursor]?.value === '{') {
      let depth = 1;
      for (cursor++; cursor < tokens.length && depth; cursor++) {
        if (tokens[cursor].value === '{') depth++;
        else if (tokens[cursor].value === '}') depth--;
      }
      return depth ? null : cursor;
    }
    if (tokens[cursor]?.value === '*' && tokens[cursor + 1]?.value === 'as' && tokens[cursor + 2]?.type === 'identifier') return cursor + 3;
    if (tokens[cursor]?.value === '*' && !allowDefault) return cursor + 1;
    return null;
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'identifier' || tokens[index - 1]?.value === '.') continue;
    if ((token.value === 'import' || token.value === 'require') && tokens[index + 1]?.value === '(' && tokens[index + 2]?.type === 'string') names.push(tokens[index + 2].value);
    else if (token.value === 'import' && tokens[index + 1]?.type === 'string') names.push(tokens[index + 1].value);
    else if (token.value === 'import' || token.value === 'export') {
      const cursor = afterBindings(index + 1,token.value === 'import');
      if (cursor !== null && tokens[cursor]?.value === 'from' && tokens[cursor + 1]?.type === 'string') names.push(tokens[cursor + 1].value);
    }
  }
  return names;
}

function hasLiteralViteAliasImport(file, viteConfigs) {
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file.path)) return false;
  const candidates = viteConfigs.filter(item => !item.directory || file.path.startsWith(`${item.directory}/`));
  const nearest = candidates.filter(item => item.directory.length === candidates[0]?.directory.length);
  const aliases = nearest.flatMap(item => item.aliases || []);
  if (!aliases.length) return false;
  const tokens = javascriptSourceTokens(file.content);
  if (!tokens) return false; // Unsupported syntax is not evidence of an alias import.
  for (const name of literalImportNames(tokens)) {
    if (name.includes('\\')) return true;
    // TypeScript paths do not prove Vite resolves the same target.
    if (aliases.some(alias => name === alias.find || alias.find.endsWith('/') && name.startsWith(alias.find) || name.startsWith(`${alias.find}/`))) return true;
  }
  return false;
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

function pythonSourceBoundaries(files) {
  return files.filter(file => /(?:^|\/)pyproject\.toml$/.test(file.path)).map(file => {
    const directory = path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path);
    let section = '', hasSrcLayout = false;
    if (file.status === 'read' && typeof file.content === 'string') for (const line of file.content.split(/\r?\n/)) {
      const heading = line.trim().match(/^\[([^\]]+)\](?:\s*#.*)?$/);
      if (heading) { section = heading[1]; continue; }
      if (section === 'tool.setuptools.packages.find' && /^\s*where\s*=\s*\[\s*["']src["']\s*\]\s*(?:#.*)?$/.test(line)) hasSrcLayout = true;
      if (section === 'tool.setuptools' && /^\s*package-dir\s*=\s*\{\s*""\s*=\s*"src"\s*\}\s*(?:#.*)?$/.test(line)) hasSrcLayout = true;
    }
    return { directory, sourceRoot: hasSrcLayout ? path.posix.join(directory,'src') : null };
  }).sort((a,b) => b.directory.length - a.directory.length);
}

function pythonTargets(file, moduleName, indexed, sourceRoot = null) {
  const dots = moduleName.match(/^\.+/)?.[0].length || 0;
  const name = moduleName.slice(dots).replaceAll('.', '/');
  const parent = dots ? path.posix.join(path.posix.dirname(file.path),...Array(dots - 1).fill('..')) : '';
  const base = path.posix.normalize(path.posix.join(parent,name));
  if (!base || base === '.' || base.startsWith('../') || base.startsWith('/')) return [];
  const roots = dots || !sourceRoot ? [base] : [base,path.posix.join(sourceRoot,base)];
  return roots.flatMap(root => [`${root}.py`,`${root}/__init__.py`]).filter(candidate => indexed.has(candidate));
}

function pythonImports(file, indexed, sourceBoundaries = null) {
  if (!file.path.endsWith('.py')) return [];
  const boundary = sourceBoundaries?.find(item => !item.directory || file.path.startsWith(`${item.directory}/`));
  const sourceRoot = boundary?.sourceRoot || null;
  const found = new Set();
  const pattern = /^\s*(?:from\s+([.\w]+)\s+import\s+([^#\n]+)|import\s+([^#\n]+))/gm;
  let match, count = 0;
  while ((match = pattern.exec(file.content)) && count++ < 200) {
    if (match[1]) {
      for (const target of pythonTargets(file,match[1],indexed,sourceRoot)) found.add(target);
      for (const name of match[2].split(',')) {
        const imported = name.trim().split(/\s+as\s+/)[0];
        if (/^[A-Za-z_]\w*$/.test(imported)) for (const target of pythonTargets(file,`${match[1]}${match[1].endsWith('.') ? '' : '.'}${imported}`,indexed,sourceRoot)) found.add(target);
      }
    } else for (const name of match[3].split(',')) {
      const imported = name.trim().split(/\s+as\s+/)[0];
      if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(imported)) for (const target of pythonTargets(file,imported,indexed,sourceRoot)) found.add(target);
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

function goPackageName(content) {
  let offset = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (offset < content.length) {
    const rest = content.slice(offset);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { offset += whitespace[0].length; continue; }
    if (rest.startsWith('//')) { offset += rest.indexOf('\n') < 0 ? rest.length : rest.indexOf('\n') + 1; continue; }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/');
      if (end < 0) return null;
      offset += end + 2;
      continue;
    }
    return rest.match(/^package[ \t]+([A-Za-z_]\w*)[ \t]*(?:\/\/[^\n]*)?(?:\r?\n|$)/)?.[1] || null;
  }
  return null;
}

function goModuleName(content) {
  const first = content.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('//'));
  return first?.match(/^module[ \t]+([^\s]+)(?:[ \t]*\/\/.*)?$/)?.[1] || null;
}

function goImportsV8(file, indexed, boundaries, packages) {
  if (!file.path.endsWith('.go')) return [];
  const packageName = packages.get(file.path);
  const found = new Set();
  if (!packageName) return [];
  const boundaryFor = name => boundaries.find(item => !item.directory || name.startsWith(`${item.directory}/`));
  const boundary = boundaryFor(file.path);
  for (const target of indexed) {
    if (target === file.path || !target.endsWith('.go') || !file.path.endsWith('_test.go') && target.endsWith('_test.go') || path.posix.dirname(target) !== path.posix.dirname(file.path)) continue;
    if (packages.get(target) === packageName) found.add(target);
  }
  if (!boundary?.name) return [...found];
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
    if (name !== boundary.name && !name.startsWith(`${boundary.name}/`)) continue;
    const suffix = name.slice(boundary.name.length).replace(/^\//,'');
    const directory = path.posix.join(boundary.directory,suffix);
    for (const target of indexed) {
      if (target === file.path || !target.endsWith('.go') || target.endsWith('_test.go') || path.posix.dirname(target) !== directory || boundaryFor(target)?.path !== boundary.path) continue;
      if (packages.has(target)) found.add(target);
    }
  }
  return [...found];
}

function importedPaths(file, indexed, goModules, aliasConfigs = [], includeSameDepth = false, goBoundaries = null, goPackages = null, pythonBoundaries = null) {
  if (typeof file.content !== 'string') return [];
  return [...new Set([...javascriptImports(file,indexed,true),...javascriptAliasedImports(file,indexed,aliasConfigs,includeSameDepth),...pythonImports(file,indexed,pythonBoundaries),...(goBoundaries ? goImportsV8(file,indexed,goBoundaries,goPackages) : goImports(file,indexed,goModules))])];
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

function selectImpactEvidence(files, changes, includeApiRoutes, includeAliases = false, includeExtends = false, includeNestedConfigs = false, includePythonSrc = false, includeViteAliases = false, includeSqlTables = false, includeDynamicApi = false, includeDynamicSql = false) {
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
  const goPackages = includeNestedConfigs ? new Map(files.filter(file => file.path.endsWith('.go') && file.status === 'read' && typeof file.content === 'string').map(file => [file.path,goPackageName(file.content)]).filter(([,name]) => name)) : null;
  const goBoundaries = includeNestedConfigs ? files.filter(file => /(?:^|\/)go\.mod$/.test(file.path)).map(file => ({ path: file.path, directory: path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path), name: file.status === 'read' && typeof file.content === 'string' ? goModuleName(file.content) : null })).sort((a,b) => b.directory.length - a.directory.length) : null;
  const pythonBoundaries = includePythonSrc ? pythonSourceBoundaries(files) : null;
  const apiEdges = includeApiRoutes ? projectApiDependencyEdges(files) : new Map();
  const sqlEdges = includeSqlTables ? projectSqlDependencyEdges(files) : new Map();
  const unknownApi = includeDynamicApi ? dynamicApiFiles(files) : new Set();
  const sqlChanged = changes.some(change => /\.sql$/i.test(change.path) || change.oldPath && /\.sql$/i.test(change.oldPath));
  const unknownSql = includeDynamicSql && sqlChanged ? dynamicSqlFiles(files) : new Set();
  const aliasConfigs = includeAliases ? javascriptAliasConfigs(files,includeExtends) : [];
  const viteConfigs = includeViteAliases ? viteAliasConfigs(files) : null;
  const reverse = new Map();
  const importsByPath = new Map();
  const uncertainViteImporters = new Set();
  for (const file of files) {
    if (file.status !== 'read') continue;
    const imports = [...new Set([...importedPaths(file,indexed,goModules,aliasConfigs,includeExtends,goBoundaries,goPackages,pythonBoundaries),...(apiEdges.get(file.path) || []),...(sqlEdges.get(file.path) || [])])];
    if (viteConfigs && typeof file.content === 'string' && hasLiteralViteAliasImport(file,viteConfigs)) uncertainViteImporters.add(file.path);
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
  // Dynamic API targets and Vite aliases are uncertain on any change;
  // computed SQL is uncertain when a SQL file changes.
  const uncertainLayers = [];
  const uncertainSources = new Set([...uncertainViteImporters,...unknownApi,...unknownSql]);
  if (changedPaths.size && uncertainSources.size) {
    let pending = [...uncertainSources].filter(name => !visited.has(name));
    for (const name of uncertainSources) impactedModules.add(projectModuleKey(name));
    while (pending.length) {
      uncertainLayers.push(pending.sort());
      for (const name of pending) visited.add(name);
      const next = new Set();
      for (const name of pending) for (const caller of reverse.get(name) || []) if (!visited.has(caller)) {
        impactedModules.add(projectModuleKey(caller));
        next.add(caller);
      }
      pending = [...next];
    }
  }
  if (changes.some(change => rootConfig.test(change.path) || change.oldPath && rootConfig.test(change.oldPath) || includeAliases && (aliasConfigPath.test(change.path) || change.oldPath && aliasConfigPath.test(change.oldPath)) || includeNestedConfigs && (nestedConfigPath.test(change.path) || change.oldPath && nestedConfigPath.test(change.oldPath)))) for (const file of files) impactedModules.add(projectModuleKey(file.path));
  if (includeSqlTables && changedSqlNeedsBroadReview(changes,files)) for (const file of files) impactedModules.add(projectModuleKey(file.path));
  const priorityPaths = [...currentChanged].sort().concat(...layers,[...dependencies].sort(),...uncertainLayers);
  return { selected: selectProjectEvidence(files,{ priorityPaths }), impactedModules, priorityPaths };
}

export const selectProjectImpactEvidence = (files, changes) => selectImpactEvidence(files,changes,false);
export const selectProjectImpactEvidenceV5 = (files, changes) => selectImpactEvidence(files,changes,true);
export const selectProjectImpactEvidenceV6 = (files, changes) => selectImpactEvidence(files,changes,true,true);
export const selectProjectImpactEvidenceV7 = (files, changes) => selectImpactEvidence(files,changes,true,true,true);
export const selectProjectImpactEvidenceV8 = (files, changes) => selectImpactEvidence(files,changes,true,true,true,true);
export const selectProjectImpactEvidenceV9 = (files, changes) => selectImpactEvidence(files,changes,true,true,true,true,true);
export const selectProjectImpactEvidenceV10 = (files, changes) => selectImpactEvidence(files,changes,true,true,true,true,true,true);
export const selectProjectImpactEvidenceV13 = (files, changes) => selectImpactEvidence(files,changes,true,true,true,true,true,true,true);
export const selectProjectImpactEvidenceV14 = (files, changes) => selectImpactEvidence(files,changes,true,true,true,true,true,true,true,true);
export const projectImpactPriorityPathsV14 = (files, changes) => selectProjectImpactEvidenceV14(files,changes).priorityPaths;
export const selectProjectImpactEvidenceV15 = (files, changes) => selectImpactEvidence(files,changes,true,true,true,true,true,true,true,true,true);
export const projectImpactPriorityPathsV15 = (files, changes) => selectProjectImpactEvidenceV15(files,changes).priorityPaths;
