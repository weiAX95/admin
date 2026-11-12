import path from 'node:path';

const sourcePath = /\.(?:[cm]?[jt]sx?|py|go)$/;
const serverLiteral = /\bpathname\s*(?:===|==|\.startsWith\(\s*)\s*['"`](\/api\/[A-Za-z0-9_/-]+)/g;
const serverRegex = /\bpathname\.match\(\s*\/\^((?:\\\/[A-Za-z0-9_-]+)+)/g;
const routeRegistration = /\b(?:app|router|server)\.(?:get|post|put|patch|delete|del|GET|POST|PUT|PATCH|DELETE)\s*\(\s*['"`](\/api\/[A-Za-z0-9_/-]+)/g;
const pythonRoute = /@(?:app|router)\.(?:get|post|put|patch|delete)\s*\(\s*['"](\/api\/[A-Za-z0-9_/-]+)/g;
const goRoute = /\b(?:HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE)\s*\(\s*["`](\/api\/[A-Za-z0-9_/-]+)/g;
const clientHttp = /\b(?:http|axios)\.(?:get|post|put|patch|delete|del)(?:<[^\n(]+>)?\s*\(\s*['"`](\/[A-Za-z0-9_/-]+)/g;
const clientFetch = /\bfetch\s*\(\s*['"`](\/api\/[A-Za-z0-9_/-]+)/g;
const dynamicCall = /\b(?:fetch|(?:axios|http|app|router|server)\.(?:get|post|put|patch|delete|del|use|route|GET|POST|PUT|PATCH|DELETE)|HandleFunc|Handle)\s*\(\s*([^\n)]{1,160})/g;
const dynamicPathname = /\bpathname\s*(?:===|==|\.startsWith\s*\()\s*(?!['"`/])\b[A-Za-z_$][\w$]*/g;
const routerMount = /\b(?:app|server)\.use\s*\(\s*['"`](\/api(?:\/[A-Za-z0-9_/-]+)?)['"`]\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
const defaultImport = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+['"](\.{1,2}\/[^'"\n]+)['"]/g;
const namedImport = /\bimport\s*\{([^}\n]+)\}\s*from\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;
const requiredImport = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*\)/g;
const localRoute = /\b([A-Za-z_$][\w$]*)\.(?:get|post|put|patch|delete|del|GET|POST|PUT|PATCH|DELETE)\s*\(\s*['"`](\/[A-Za-z0-9_:/-]*)['"`]/g;
const exportedRouter = /^\s*(?:export\s+default\s+([A-Za-z_$][\w$]*)|module\.exports\s*=\s*([A-Za-z_$][\w$]*))\s*;?\s*$/gm;
const namedExportList = /\bexport\s*\{([^}\n]+)\}/g;

function codePositions(content) {
  const positions = new Uint8Array(content.length);
  for (let index = 0; index < content.length;) {
    const char = content[index], next = content[index + 1];
    if (char === '/' && next === '/') {
      const end = content.indexOf('\n',index + 2);
      index = end < 0 ? content.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = content.indexOf('*/',index + 2);
      index = end < 0 ? content.length : end + 2;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      const quote = char;
      index++;
      while (index < content.length) {
        if (content[index] === '\\') { index += 2; continue; }
        if (content[index++] === quote) break;
      }
      continue;
    }
    positions[index++] = 1;
  }
  return positions;
}

function inCode(match, positions) {
  if (!positions) return true;
  const first = match[0].search(/\S/);
  return first >= 0 && positions[match.index + first] === 1;
}

function namedRouterExport(content, exportedName, positions = null) {
  const declaration = new RegExp(`^\\s*export\\s+(?:const|let|var)\\s+${exportedName}\\b`,'gm');
  let declared, declarationCount = 0;
  while ((declared = declaration.exec(content)) && declarationCount++ < 100) {
    if (inCode(declared,positions)) return exportedName;
  }
  namedExportList.lastIndex = 0;
  let match, count = 0;
  while ((match = namedExportList.exec(content)) && count++ < 100) {
    if (!inCode(match,positions)) continue;
    for (const entry of match[1].split(',')) {
      const item = entry.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (item && (item[2] || item[1]) === exportedName) return item[1];
    }
  }
  return null;
}

function collect(content, patterns, transform = value => value, positions = null) {
  const values = new Set();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match, count = 0;
    while ((match = pattern.exec(content)) && count++ < 200) {
      if (!inCode(match,positions)) continue;
      const value = transform(match[1]);
      const segments = value.split('/').filter(Boolean);
      if (segments[0] === 'api' && segments.length >= 2) values.add(`/${segments.join('/')}`);
    }
  }
  return values;
}

function routePrefixes(file, positions = null) {
  const server = collect(file.content,[serverLiteral,serverRegex,routeRegistration,pythonRoute,goRoute],value => value.replaceAll('\\/','/'),positions);
  const client = collect(file.content,[clientHttp,clientFetch],value => value.startsWith('/api/') ? value : `/api${value}`,positions);
  return { server, client };
}

function routerMountEndpoints(files, includeNamedImports = false, ignoreNonCode = false) {
  const indexed = new Map(files.filter(file => file.status === 'read' && typeof file.content === 'string' && /\.(?:[cm]?[jt]sx?)$/.test(file.path)).map(file => [file.path,file]));
  const positions = ignoreNonCode ? new Map([...indexed].map(([name,file]) => [name,codePositions(file.content)])) : new Map();
  const endpoints = [];
  for (const file of indexed.values()) {
    const sourcePositions = positions.get(file.path);
    const imports = new Map();
    for (const pattern of [defaultImport,requiredImport]) {
      pattern.lastIndex = 0;
      let match, count = 0;
      while ((match = pattern.exec(file.content)) && count++ < 200) if (inCode(match,sourcePositions)) imports.set(match[1],{ source: match[2], exportedName: null });
    }
    if (includeNamedImports) {
      namedImport.lastIndex = 0;
      let match, count = 0;
      while ((match = namedImport.exec(file.content)) && count++ < 200) {
        if (!inCode(match,sourcePositions)) continue;
        for (const entry of match[1].split(',')) {
          const item = entry.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
          if (item) imports.set(item[2] || item[1],{ source: match[2], exportedName: item[1] });
        }
      }
    }
    routerMount.lastIndex = 0;
    let mount, count = 0;
    while ((mount = routerMount.exec(file.content)) && count++ < 100) {
      if (!inCode(mount,sourcePositions)) continue;
      const prefix = mount[1].replace(/\/$/,'');
      const variable = mount[2];
      let target = file;
      if (imports.has(variable)) {
        const imported = imports.get(variable);
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path),imported.source));
        if (resolved.startsWith('../') || resolved.startsWith('/')) continue;
        const emittedSource = resolved.replace(/\.(?:mjs|cjs|js)$/,'.ts');
        target = [resolved,emittedSource,emittedSource.replace(/\.ts$/,'.tsx'),`${resolved}.ts`,`${resolved}.tsx`,`${resolved}.js`,`${resolved}.mjs`,`${resolved}.cjs`,`${resolved}/index.ts`,`${resolved}/index.js`]
          .map(candidate => indexed.get(candidate)).find(Boolean);
        if (!target) continue;
      }
      let routerName = variable;
      if (target !== file) {
        if (imports.get(variable)?.exportedName) routerName = namedRouterExport(target.content,imports.get(variable).exportedName,positions.get(target.path));
        else {
          exportedRouter.lastIndex = 0;
          routerName = null;
          let exportMatch, exportCount = 0;
          while ((exportMatch = exportedRouter.exec(target.content)) && exportCount++ < 100) {
            if (!inCode(exportMatch,positions.get(target.path))) continue;
            routerName = exportMatch[1] || exportMatch[2];
            break;
          }
        }
        if (!routerName) continue;
      }
      localRoute.lastIndex = 0;
      let route, routeCount = 0;
      while ((route = localRoute.exec(target.content)) && routeCount++ < 200) {
        if (!inCode(route,positions.get(target.path)) || route[1] !== routerName) continue;
        const staticPath = route[2].split('/:')[0];
        const fullPath = `${prefix}${staticPath === '/' ? '' : staticPath}`;
        if (fullPath.split('/').filter(Boolean).length < 2) continue;
        endpoints.push({ path: target.path, route: fullPath });
        if (target !== file) endpoints.push({ path: file.path, route: fullPath });
      }
    }
  }
  return endpoints;
}

function relatedRoutes(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function projectApiDependencyEdges(files, includeRouterMounts = false, includeNamedImports = false, ignoreNonCode = false, ignoreDirectJsComments = false) {
  const endpoints = files.filter(file => file.status === 'read' && typeof file.content === 'string' && sourcePath.test(file.path)).map(file => ({
    path: file.path,
    ...routePrefixes(file,ignoreDirectJsComments && /\.(?:[cm]?[jt]sx?)$/.test(file.path) ? codePositions(file.content) : null)
  }));
  const servers = new Map();
  const root = route => route.split('/').slice(0,3).join('/');
  for (const file of endpoints) for (const route of file.server) {
    const key = root(route);
    if (!servers.has(key)) servers.set(key,[]);
    servers.get(key).push({ path: file.path, route });
  }
  if (includeRouterMounts) for (const endpoint of routerMountEndpoints(files,includeNamedImports,ignoreNonCode)) {
    const key = root(endpoint.route);
    if (!servers.has(key)) servers.set(key,[]);
    servers.get(key).push(endpoint);
  }
  const edges = new Map();
  for (const client of endpoints) {
    for (const request of client.client) for (const server of servers.get(root(request)) || []) {
      if (client.path === server.path || !relatedRoutes(request,server.route)) continue;
      if (!edges.has(client.path)) edges.set(client.path,new Set());
      edges.get(client.path).add(server.path);
    }
  }
  return edges;
}

export function dynamicApiFiles(files, ignoreJsComments = false) {
  const found = new Set();
  for (const file of files) {
    if (file.status !== 'read' || typeof file.content !== 'string' || !sourcePath.test(file.path) || file.content.length > 250000) continue;
    const positions = ignoreJsComments && /\.(?:[cm]?[jt]sx?)$/.test(file.path) ? codePositions(file.content) : null;
    dynamicCall.lastIndex = 0;
    let match, count = 0;
    while ((match = dynamicCall.exec(file.content)) && count++ < 200) {
      if (!inCode(match,positions)) continue;
      const argument = match[1].trim();
      const quote = argument[0];
      if (!['\'', '"', '`'].includes(quote)) { found.add(file.path); break; }
      const end = argument.indexOf(quote,1);
      if (end < 0 || quote === '`' && argument.slice(1,end).includes('${') || /^\s*\+/.test(argument.slice(end + 1))) { found.add(file.path); break; }
    }
    if (found.has(file.path)) continue;
    dynamicPathname.lastIndex = 0;
    count = 0;
    while ((match = dynamicPathname.exec(file.content)) && count++ < 200) {
      if (inCode(match,positions)) { found.add(file.path); break; }
    }
  }
  return found;
}
