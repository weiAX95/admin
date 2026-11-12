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
const requiredImport = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*\)/g;
const localRoute = /\b([A-Za-z_$][\w$]*)\.(?:get|post|put|patch|delete|del|GET|POST|PUT|PATCH|DELETE)\s*\(\s*['"`](\/[A-Za-z0-9_:/-]*)['"`]/g;
const exportedRouter = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?|\bmodule\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g;

function collect(content, patterns, transform = value => value) {
  const values = new Set();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match, count = 0;
    while ((match = pattern.exec(content)) && count++ < 200) {
      const value = transform(match[1]);
      const segments = value.split('/').filter(Boolean);
      if (segments[0] === 'api' && segments.length >= 2) values.add(`/${segments.join('/')}`);
    }
  }
  return values;
}

function routePrefixes(file) {
  const server = collect(file.content,[serverLiteral,serverRegex,routeRegistration,pythonRoute,goRoute],value => value.replaceAll('\\/','/'));
  const client = collect(file.content,[clientHttp,clientFetch],value => value.startsWith('/api/') ? value : `/api${value}`);
  return { server, client };
}

function routerMountEndpoints(files) {
  const indexed = new Map(files.filter(file => file.status === 'read' && typeof file.content === 'string' && /\.(?:[cm]?[jt]sx?)$/.test(file.path)).map(file => [file.path,file]));
  const endpoints = [];
  for (const file of indexed.values()) {
    const imports = new Map();
    for (const pattern of [defaultImport,requiredImport]) {
      pattern.lastIndex = 0;
      let match, count = 0;
      while ((match = pattern.exec(file.content)) && count++ < 200) imports.set(match[1],match[2]);
    }
    routerMount.lastIndex = 0;
    let mount, count = 0;
    while ((mount = routerMount.exec(file.content)) && count++ < 100) {
      const prefix = mount[1].replace(/\/$/,'');
      const variable = mount[2];
      let target = file;
      if (imports.has(variable)) {
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path),imports.get(variable)));
        if (resolved.startsWith('../') || resolved.startsWith('/')) continue;
        const emittedSource = resolved.replace(/\.(?:mjs|cjs|js)$/,'.ts');
        target = [resolved,emittedSource,emittedSource.replace(/\.ts$/,'.tsx'),`${resolved}.ts`,`${resolved}.tsx`,`${resolved}.js`,`${resolved}.mjs`,`${resolved}.cjs`,`${resolved}/index.ts`,`${resolved}/index.js`]
          .map(candidate => indexed.get(candidate)).find(Boolean);
        if (!target) continue;
      }
      let routerName = variable;
      if (target !== file) {
        exportedRouter.lastIndex = 0;
        const exportMatch = exportedRouter.exec(target.content);
        routerName = exportMatch?.[1] || exportMatch?.[2];
        if (!routerName) continue;
      }
      localRoute.lastIndex = 0;
      let route, routeCount = 0;
      while ((route = localRoute.exec(target.content)) && routeCount++ < 200) {
        if (route[1] !== routerName) continue;
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

export function projectApiDependencyEdges(files, includeRouterMounts = false) {
  const endpoints = files.filter(file => file.status === 'read' && typeof file.content === 'string' && sourcePath.test(file.path)).map(file => ({ path: file.path, ...routePrefixes(file) }));
  const servers = new Map();
  const root = route => route.split('/').slice(0,3).join('/');
  for (const file of endpoints) for (const route of file.server) {
    const key = root(route);
    if (!servers.has(key)) servers.set(key,[]);
    servers.get(key).push({ path: file.path, route });
  }
  if (includeRouterMounts) for (const endpoint of routerMountEndpoints(files)) {
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

export function dynamicApiFiles(files) {
  const found = new Set();
  for (const file of files) {
    if (file.status !== 'read' || typeof file.content !== 'string' || !sourcePath.test(file.path) || file.content.length > 250000) continue;
    dynamicCall.lastIndex = 0;
    let match, count = 0;
    while ((match = dynamicCall.exec(file.content)) && count++ < 200) {
      const argument = match[1].trim();
      const quote = argument[0];
      if (!['\'', '"', '`'].includes(quote)) { found.add(file.path); break; }
      const end = argument.indexOf(quote,1);
      if (end < 0 || quote === '`' && argument.slice(1,end).includes('${') || /^\s*\+/.test(argument.slice(end + 1))) { found.add(file.path); break; }
    }
    if (found.has(file.path)) continue;
    dynamicPathname.lastIndex = 0;
    if (dynamicPathname.test(file.content)) found.add(file.path);
  }
  return found;
}
