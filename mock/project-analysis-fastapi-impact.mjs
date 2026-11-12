import path from 'node:path';

const routerDeclaration = /^\s*([A-Za-z_]\w*)\s*=\s*APIRouter\s*\(/gm;
const appDeclaration = /^\s*([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/gm;
const fromImport = /^\s*from\s+(\.+[A-Za-z_\d.]*|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\s+([^#\n]+)$/gm;
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

function importsFor(file, indexed, positions, includeAbsoluteImports) {
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
  return imports;
}

function operationPaths(content, positions, routerName) {
  const paths = [];
  const pattern = new RegExp(`@${routerName}\\.(?:get|post|put|patch|delete|options|head)\\s*\\(\\s*['\"](\\/[A-Za-z0-9_{}\\/-]*)['\"]`,'g');
  let match, count = 0;
  while ((match = pattern.exec(content)) && count++ < 200) {
    if (inCode(match,positions)) paths.push(match[1].split('/{')[0]);
  }
  return paths;
}

export function fastApiMountedEndpoints(files, includeAbsoluteImports = false) {
  const indexed = new Map(files.filter(file => file.path.endsWith('.py') && file.status === 'read' && typeof file.content === 'string').map(file => [file.path,file]));
  const positions = new Map([...indexed].map(([name,file]) => [name,codePositions(file.content)]));
  const routers = new Map([...indexed].map(([name,file]) => [name,declarations(file.content,positions.get(name),routerDeclaration)]));
  const endpoints = [];
  for (const file of indexed.values()) {
    const sourcePositions = positions.get(file.path);
    const apps = declarations(file.content,sourcePositions,appDeclaration);
    if (!apps.size) continue;
    const imports = importsFor(file,indexed,sourcePositions,includeAbsoluteImports);
    includeRouter.lastIndex = 0;
    let match, count = 0;
    while ((match = includeRouter.exec(file.content)) && count++ < 100) {
      if (!inCode(match,sourcePositions) || !apps.has(match[1])) continue;
      const opening = file.content.indexOf('(',match.index);
      const mountPrefix = literalPrefix(callArguments(file.content,opening,sourcePositions),sourcePositions);
      if (mountPrefix === null) continue;
      const imported = imports.get(match[2]);
      const target = imported ? indexed.get(imported.path) : file;
      const routerName = match[3] || imported?.member || match[2];
      if (!target || imported && match[3] && imported.member || !routers.get(target.path)?.has(routerName)) continue;
      const routerPrefix = routers.get(target.path).get(routerName);
      for (const operation of operationPaths(target.content,positions.get(target.path),routerName)) {
        const route = `/${[mountPrefix,routerPrefix,operation].flatMap(part => part.split('/')).filter(Boolean).join('/')}`;
        if (!/^\/api\/[A-Za-z0-9_/-]+$/.test(route)) continue;
        endpoints.push({ path:target.path, route });
        if (target !== file) endpoints.push({ path:file.path, route });
      }
    }
  }
  return endpoints;
}
