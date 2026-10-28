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

function relatedRoutes(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function projectApiDependencyEdges(files) {
  const endpoints = files.filter(file => file.status === 'read' && typeof file.content === 'string' && sourcePath.test(file.path)).map(file => ({ path: file.path, ...routePrefixes(file) }));
  const servers = new Map();
  const root = route => route.split('/').slice(0,3).join('/');
  for (const file of endpoints) for (const route of file.server) {
    const key = root(route);
    if (!servers.has(key)) servers.set(key,[]);
    servers.get(key).push({ path: file.path, route });
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
