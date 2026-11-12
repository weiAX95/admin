import path from 'node:path';

const routerDeclaration = /^\s*([A-Za-z_]\w*)\s*=\s*APIRouter\s*\(/gm;
const appDeclaration = /^\s*([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/gm;
const fromImport = /^\s*from\s+(\.+[A-Za-z_\d.]*|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+([^#\n]+)$/gm;
const aliasedImport = /^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s+as\s+([A-Za-z_]\w*)\s*(?:#.*)?$/gm;
const includeRouter = /\b([A-Za-z_]\w*)\.include_router\s*\(\s*([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/g;

function codePositions(content) {
  const positions = new Uint8Array(content.length);
  for (let index = 0; index < content.length;) {
    const char = content[index];
    if (char === '#') {
      const end = content.indexOf('\n',index + 1);
      index = end < 0 ? content.length : end;
      continue;
    }
    if (char === '\'' || char === '"') {
      const quote = content.slice(index,index + 3) === char.repeat(3) ? char.repeat(3) : char;
      index += quote.length;
      while (index < content.length) {
        if (content[index] === '\\') { index += 2; continue; }
        if (content.startsWith(quote,index)) { index += quote.length; break; }
        index++;
      }
      continue;
    }
    positions[index++] = 1;
  }
  return positions;
}

function inCode(match, positions) {
  const first = match[0].search(/\S/);
  return first >= 0 && positions[match.index + first] === 1;
}

function callArguments(content, opening, positions) {
  let depth = 0;
  for (let index = opening; index < content.length && index < opening + 1200; index++) {
    if (!positions[index]) continue;
    if (content[index] === '(') depth++;
    if (content[index] !== ')') continue;
    if (--depth === 0) return { text:content.slice(opening + 1,index), start:opening + 1 };
  }
  return null;
}

function literalPrefix(argumentsSource, positions) {
  if (argumentsSource === null) return null;
  const pattern = /\bprefix\s*=\s*/g;
  let match;
  while ((match = pattern.exec(argumentsSource.text))) {
    if (!positions[argumentsSource.start + match.index]) continue;
    const value = argumentsSource.text.slice(pattern.lastIndex).match(/^(['"])(\/[A-Za-z0-9_/-]*)\1/);
    return value?.[2] ?? null;
  }
  return '';
}

function declarations(content, positions, pattern) {
  const found = new Map();
  pattern.lastIndex = 0;
  let match, count = 0;
  while ((match = pattern.exec(content)) && count++ < 100) {
    if (!inCode(match,positions)) continue;
    const opening = content.indexOf('(',match.index);
    const prefix = literalPrefix(callArguments(content,opening,positions),positions);
    if (prefix !== null) found.set(match[1],prefix);
  }
  found.incomplete = count > 100;
  return found;
}

function relativeModule(filePath, moduleName) {
  const dots = moduleName.match(/^\.+/)[0].length;
  let directory = path.posix.dirname(filePath);
  for (let index = 1; index < dots; index++) directory = path.posix.dirname(directory);
  const suffix = moduleName.slice(dots).replaceAll('.','/');
  const result = path.posix.normalize(path.posix.join(directory,suffix));
  return result.startsWith('../') || result.startsWith('/') ? null : result;
}

function uniqueAbsoluteModule(sourcePath, modulePath, indexed) {
  const suffix = `/${modulePath}.py`;
  const candidates = [...indexed.keys()].filter(name => name === `${modulePath}.py` || name.endsWith(suffix));
  if (candidates.length !== 1) return null;
  let directory = path.posix.dirname(sourcePath);
  while (true) {
    const expected = path.posix.normalize(path.posix.join(directory,modulePath + '.py'));
    if (expected === candidates[0]) return expected;
    if (directory === '.' || directory === '') break;
    directory = path.posix.dirname(directory);
  }
  return null;
}

function importsFor(file, indexed, positions, includeAbsoluteImports, includeAliasedImports) {
  const imports = new Map();
  fromImport.lastIndex = 0;
  let match, count = 0;
  while ((match = fromImport.exec(file.content)) && count++ < 100) {
    if (!inCode(match,positions)) continue;
    const relative = match[1].startsWith('.');
    if (!relative && !includeAbsoluteImports) continue;
    const base = relative ? relativeModule(file.path,match[1]) : match[1].replaceAll('.','/');
    if (!base) continue;
    for (const entry of match[2].split(',')) {
      const item = entry.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
      if (!item) continue;
      const alias = item[2] || item[1];
      const modulePath = relative ? indexed.has(`${base}/${item[1]}.py`) ? `${base}/${item[1]}.py` : null : uniqueAbsoluteModule(file.path,`${base}/${item[1]}`,indexed);
      const memberPath = relative ? indexed.has(`${base}.py`) ? `${base}.py` : null : uniqueAbsoluteModule(file.path,base,indexed);
      if (relative) {
        if (modulePath) imports.set(alias,{ path:modulePath, member:null });
        else if (memberPath) imports.set(alias,{ path:memberPath, member:item[1] });
      } else if (modulePath && !memberPath) imports.set(alias,{ path:modulePath, member:null });
      else if (memberPath && !modulePath) imports.set(alias,{ path:memberPath, member:item[1] });
    }
  }
  let incomplete = count > 100;
  if (includeAliasedImports) {
    aliasedImport.lastIndex = 0;
    count = 0;
    while ((match = aliasedImport.exec(file.content)) && count++ < 100) {
      if (!inCode(match,positions)) continue;
      const target = uniqueAbsoluteModule(file.path,match[1].replaceAll('.','/'),indexed);
      if (target && !imports.has(match[2])) imports.set(match[2],{ path:target, member:null });
    }
    incomplete ||= count > 100;
  }
  imports.incomplete = incomplete;
  return imports;
}

function operationPaths(content, positions, routerName) {
  const paths = [];
  const pattern = new RegExp(`@${routerName}\\.(?:get|post|put|patch|delete|options|head)\\s*\\(\\s*['\"](\\/[A-Za-z0-9_{}\\/-]*)['\"]`,'g');
  let match, count = 0;
  while ((match = pattern.exec(content)) && count++ < 200) {
    if (inCode(match,positions)) paths.push(match[1].split('/{')[0]);
  }
  paths.incomplete = count > 200;
  return paths;
}

function mountedRouter(file, match, imports, indexed, routers) {
  const imported = imports.get(match[2]);
  const target = imported ? indexed.get(imported.path) : file;
  const routerName = match[3] || imported?.member || match[2];
  if (!target || imported && match[3] && imported.member || !routers.get(target.path)?.has(routerName)) return null;
  return { target, routerName };
}

function routePath(parts) {
  const route = `/${parts.flatMap(part => part.split('/')).filter(Boolean).join('/')}`;
  return /^\/api\/[A-Za-z0-9_/-]+$/.test(route) ? route : null;
}

export function fastApiMountedEndpoints(files, includeAbsoluteImports = false, includeAliasedImports = false, includeNestedRouters = false) {
  const indexed = new Map(files.filter(file => file.path.endsWith('.py') && file.status === 'read' && typeof file.content === 'string').map(file => [file.path,file]));
  const positions = new Map([...indexed].map(([name,file]) => [name,codePositions(file.content)]));
  const routers = new Map([...indexed].map(([name,file]) => [name,declarations(file.content,positions.get(name),routerDeclaration)]));
  const routerKey = (name, router) => `${name}\0${router}`;
  const nestedMounts = new Map();
  let incomplete = includeNestedRouters && [...routers.values()].some(declared => declared.incomplete);
  if (includeNestedRouters) for (const file of indexed.values()) {
    const declared = routers.get(file.path);
    if (!declared.size) continue;
    const sourcePositions = positions.get(file.path);
    const imports = importsFor(file,indexed,sourcePositions,includeAbsoluteImports,includeAliasedImports);
    incomplete ||= imports.incomplete;
    includeRouter.lastIndex = 0;
    let match, count = 0;
    while ((match = includeRouter.exec(file.content)) && count++ < 100) {
      if (!inCode(match,sourcePositions) || !declared.has(match[1])) continue;
      const opening = file.content.indexOf('(',match.index);
      const prefix = literalPrefix(callArguments(file.content,opening,sourcePositions),sourcePositions);
      const child = mountedRouter(file,match,imports,indexed,routers);
      if (prefix === null || !child) continue;
      const key = routerKey(file.path,match[1]);
      if (!nestedMounts.has(key)) nestedMounts.set(key,[]);
      nestedMounts.get(key).push({ ...child, prefix });
    }
    incomplete ||= count > 100;
  }
  const endpoints = [];
  let nestedCount = 0;
  function appendNested(parentPath, parentRouter, prefixParts, trace, seen, depth) {
    const children = nestedMounts.get(routerKey(parentPath,parentRouter)) || [];
    if (depth >= 4 || nestedCount >= 2000 || endpoints.length >= 10000) {
      if (children.length) incomplete = true;
      return;
    }
    for (const mount of children) {
      if (nestedCount >= 2000 || endpoints.length >= 10000) { incomplete = true; break; }
      const key = routerKey(mount.target.path,mount.routerName);
      if (seen.has(key)) continue;
      nestedCount++;
      const parts = [...prefixParts,mount.prefix,routers.get(mount.target.path).get(mount.routerName)];
      const paths = [...new Set([...trace,mount.target.path])];
      const operations = operationPaths(mount.target.content,positions.get(mount.target.path),mount.routerName);
      incomplete ||= operations.incomplete;
      for (const operation of operations) {
        if (endpoints.length >= 10000) { incomplete = true; break; }
        const route = routePath([...parts,operation]);
        if (route) for (const name of paths) endpoints.push({ path:name, route });
      }
      appendNested(mount.target.path,mount.routerName,parts,paths,new Set([...seen,key]),depth + 1);
    }
  }
  for (const file of indexed.values()) {
    const sourcePositions = positions.get(file.path);
    const apps = declarations(file.content,sourcePositions,appDeclaration);
    if (includeNestedRouters) incomplete ||= apps.incomplete;
    if (!apps.size) continue;
    const imports = importsFor(file,indexed,sourcePositions,includeAbsoluteImports,includeAliasedImports);
    if (includeNestedRouters) incomplete ||= imports.incomplete;
    includeRouter.lastIndex = 0;
    let match, count = 0;
    while ((match = includeRouter.exec(file.content)) && count++ < 100) {
      if (!inCode(match,sourcePositions) || !apps.has(match[1])) continue;
      const opening = file.content.indexOf('(',match.index);
      const mountPrefix = literalPrefix(callArguments(file.content,opening,sourcePositions),sourcePositions);
      if (mountPrefix === null) continue;
      const mounted = mountedRouter(file,match,imports,indexed,routers);
      if (!mounted) continue;
      const { target, routerName } = mounted;
      const routerPrefix = routers.get(target.path).get(routerName);
      const operations = operationPaths(target.content,positions.get(target.path),routerName);
      if (includeNestedRouters) incomplete ||= operations.incomplete;
      for (const operation of operations) {
        const route = routePath([mountPrefix,routerPrefix,operation]);
        if (!route) continue;
        endpoints.push({ path:target.path, route });
        if (target !== file) endpoints.push({ path:file.path, route });
      }
      if (includeNestedRouters) appendNested(target.path,routerName,[mountPrefix,routerPrefix],[file.path,target.path],new Set([routerKey(target.path,routerName)]),0);
    }
    if (includeNestedRouters) incomplete ||= count > 100;
  }
  endpoints.incomplete = includeNestedRouters && incomplete;
  return endpoints;
}
