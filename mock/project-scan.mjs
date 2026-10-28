import crypto from 'node:crypto';
import { GithubAuthorizationError } from './project-github-auth.mjs';

const SHA = /^[a-f\d]{40}$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'vendor', 'target', '.venv', '__pycache__']);
const BINARY_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|7z|exe|dll|so|dylib|class|jar|pyc|woff2?|ttf|eot|mp[34]|mov|wav|ogg|avif|bin|db|sqlite)$/i;
const SENSITIVE_NAMES = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|service[-_]?account(?:\.[^/]*)?|terraform\.tfstate(?:\.[^/]*)?|[^/]+\.tfvars(?:\.json)?|[^/]+\.(?:pem|key|p12|pfx))$/i;
const SENSITIVE_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|xox[baprs]-[A-Za-z0-9-]{20,})\b|https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{15,}|\b(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*['"]?[^'"\s]{16,}/i;
export const containsKnownSecret = content => SENSITIVE_CONTENT.test(content);
export const isSensitiveProjectPath = path => SENSITIVE_NAMES.test(path) || containsKnownSecret(path) || path.split('/').some(part => /^(?:secret|secrets|private|credentials|\.aws|\.kube|\.ssh)$/i.test(part));

function classification(path) {
  if (/(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|\.)|\.(?:test|spec)\./i.test(path)) return 'test';
  if (/(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING)(?:\.|$)|\.(?:md|mdx|rst)$/i.test(path)) return 'documentation';
  if (/(?:^|\/)(?:package\.json|requirements\.txt|go\.mod|pyproject\.toml|Cargo\.toml|Dockerfile|vite\.config\.[^/]+)$/i.test(path)) return 'config';
  return 'source';
}

function excludedReason(path, entry, maxFileBytes) {
  const parts = path.split('/');
  if (parts.some(part => SKIP_DIRS.has(part))) return 'dependency_or_build';
  if (isSensitiveProjectPath(path)) return 'sensitive_path';
  if (entry.mode === '120000' || entry.type !== 'blob') return 'non_regular_file';
  if (BINARY_EXTENSIONS.test(path)) return 'binary_type';
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > maxFileBytes) return 'file_size';
  return null;
}

function balancedIndexOrder(entries, maxFileBytes, priorityPaths = new Set(), priorityLimit = 0) {
  const categories = ['config','source','test','documentation'];
  const modules = new Map(), excluded = [];
  for (const entry of entries) {
    if (typeof entry.path !== 'string' || !SHA.test(entry.sha || '') || entry.skippedTree || excludedReason(entry.path,entry,maxFileBytes)) { excluded.push(entry); continue; }
    const moduleKey = entry.path.includes('/') ? entry.path.split('/')[0] : '@root';
    if (!modules.has(moduleKey)) modules.set(moduleKey,new Map(categories.map(name => [name,[]])));
    modules.get(moduleKey).get(classification(entry.path)).push(entry);
  }
  const buckets = [...modules].sort(([left],[right]) => left.localeCompare(right)).map(([,groups]) => {
    for (const files of groups.values()) files.sort((a,b) => a.path.localeCompare(b.path));
    return { groups, positions: new Map(categories.map(name => [name,0])) };
  });
  const ordered = [];
  let preferred = 0, remaining = entries.length - excluded.length;
  while (remaining) {
    for (const bucket of buckets) {
      for (let offset = 0; offset < categories.length; offset++) {
        const category = categories[(preferred + offset) % categories.length];
        const files = bucket.groups.get(category), position = bucket.positions.get(category);
        if (position >= files.length) continue;
        ordered.push(files[position]);
        bucket.positions.set(category,position + 1);
        remaining--;
        break;
      }
    }
    preferred = (preferred + 1) % categories.length;
  }
  const priority = ordered.filter(entry => priorityPaths.has(entry.path)).slice(0,priorityLimit);
  const selected = new Set(priority.map(entry => entry.path));
  return priority.concat(ordered.filter(entry => !selected.has(entry.path)),excluded.sort((a,b) => String(a.path || '').localeCompare(String(b.path || ''))));
}

async function githubFetch(url) {
  return fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-admin-project-analysis', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(10000) });
}

async function getJson(fetchGithub, url) {
  const response = await fetchGithub(url);
  if (!response.ok) {
    const headers = response.headers;
    const message = (await response.json().catch(() => ({})))?.message || '';
    const remaining = headers?.get?.('x-ratelimit-remaining');
    const retryAfter = headers?.get?.('retry-after');
    const limited = response.status === 429 || response.status === 403 && (remaining === '0' || retryAfter !== null && retryAfter !== undefined || /rate limit/i.test(message));
    let retryAfterMs = 60_000;
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const until = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(until)) retryAfterMs = Math.max(1000,until);
    } else if (remaining === '0') {
      const reset = Number(headers?.get?.('x-ratelimit-reset'));
      if (Number.isFinite(reset) && reset > 0) retryAfterMs = Math.max(1000,reset * 1000 - Date.now() + 1000);
    }
    throw Object.assign(new Error(`GitHub 读取失败（${response.status}）`), { status: response.status, rateLimited: limited, retryAfterMs: Math.min(retryAfterMs,86_400_000) });
  }
  return response.json();
}

export async function scanPublicRepository({ fullName, commitSha, expectedRepositoryId = null, fetchGithub = githubFetch, cachedBlobs = new Map(), previousFiles = [], previousCoverageComplete = false, maxFiles = 200, maxFileBytes = 262144, maxTotalBytes = 5 * 1024 * 1024, maxTreeRequests = 100, maxIndexEntries = 5000 }) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(fullName || '') || !SHA.test(commitSha || '')) throw new Error('仓库或 commit SHA 无效');
  let resolvedFullName = fullName;
  if (expectedRepositoryId !== null) {
    const repository = await getJson(fetchGithub,`https://api.github.com/repos/${fullName}`);
    if (repository?.id !== Number(expectedRepositoryId)) throw Object.assign(new Error('GitHub 仓库身份已变化'),{ code: 'GITHUB_REPOSITORY_IDENTITY_CHANGED' });
    if (typeof repository.full_name === 'string' && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository.full_name)) resolvedFullName = repository.full_name;
  }
  const base = `https://api.github.com/repos/${resolvedFullName}/git`;
  const commit = await getJson(fetchGithub, `${base}/commits/${commitSha}`);
  const treeSha = commit?.tree?.sha;
  if (!SHA.test(treeSha || '')) throw new Error('commit 没有可用的树对象');
  const recursive = await getJson(fetchGithub, `${base}/trees/${treeSha}?recursive=1`);
  if (!Array.isArray(recursive.tree)) throw new Error('GitHub 目录响应无效');
  let entries = recursive.tree;
  let unscannedSubtrees = 0;
  if (recursive.truncated === true) {
    entries = [];
    const queue = [{ sha: treeSha, prefix: '' }];
    let requests = 0;
    while (queue.length && requests < maxTreeRequests) {
      const current = queue.shift();
      requests++;
      const tree = await getJson(fetchGithub, `${base}/trees/${current.sha}`);
      if (!Array.isArray(tree.tree)) throw new Error('GitHub 子目录响应无效');
      if (tree.truncated) { unscannedSubtrees++; continue; }
      for (const entry of tree.tree) {
        const name = `${current.prefix}${entry.path}`;
        if (entry.type === 'tree' && SHA.test(entry.sha || '')) {
          if (name.split('/').some(part => SKIP_DIRS.has(part))) entries.push({ ...entry, path: name, skippedTree: true });
          else queue.push({ sha: entry.sha, prefix: `${name}/` });
        } else entries.push({ ...entry, path: name });
      }
    }
    unscannedSubtrees += queue.length;
  }
  const previous = new Map(previousFiles.filter(file => typeof file.path === 'string' && SHA.test(file.gitSha || '')).map(file => [file.path,file.gitSha.toLowerCase()]));
  const priorityPaths = new Set(entries.filter(entry => {
    const before = previous.get(entry.path);
    return before ? before !== String(entry.sha || '').toLowerCase() : previousCoverageComplete;
  }).map(entry => entry.path));
  entries = balancedIndexOrder(entries,maxFileBytes,priorityPaths,Math.floor(maxFiles / 2));
  const files = [];
  let readCount = 0, attemptedCount = 0, reusedCount = 0, failedCount = 0, excludedCount = 0, totalBytes = 0, unscannedCount = Math.max(0, entries.length - maxIndexEntries);
  for (const entry of entries.slice(0,maxIndexEntries)) {
    if (typeof entry.path !== 'string' || !SHA.test(entry.sha || '')) { unscannedCount++; continue; }
    const file = { path: entry.path, gitSha: entry.sha, size: Number.isSafeInteger(entry.size) ? entry.size : null, category: classification(entry.path) };
    const reason = entry.skippedTree ? 'dependency_or_build' : excludedReason(entry.path, entry, maxFileBytes);
    if (reason) { files.push({ ...file, status: 'excluded', reason }); excludedCount++; continue; }
    if (attemptedCount >= maxFiles) { files.push({ ...file, status: 'unscanned', reason: 'file_budget' }); unscannedCount++; continue; }
    if (totalBytes + entry.size > maxTotalBytes) { files.push({ ...file, status: 'unscanned', reason: 'byte_budget' }); unscannedCount++; continue; }
    const cached = cachedBlobs.get(entry.sha.toLowerCase());
    if (cached && typeof cached.content === 'string' && typeof cached.contentSha256 === 'string') {
      const bytes = Buffer.from(cached.content, 'utf8');
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      const gitBlobSha = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
      if (bytes.length === entry.size && digest === cached.contentSha256.toLowerCase() && gitBlobSha === entry.sha.toLowerCase() && !containsKnownSecret(cached.content)) {
        attemptedCount++;
        reusedCount++;
        readCount++;
        totalBytes += bytes.length;
        files.push({ ...file, status: 'read', contentSha256: digest, content: cached.content });
        continue;
      }
    }
    attemptedCount++;
    try {
      const data = await getJson(fetchGithub, `${base}/blobs/${entry.sha}`);
      if (data?.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('blob_format');
      const bytes = Buffer.from(data.content.replace(/\s/g, ''), 'base64');
      if (bytes.length !== entry.size || bytes.length > maxFileBytes || bytes.includes(0)) throw new Error('blob_size_or_binary');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      totalBytes += bytes.length;
      if (containsKnownSecret(content)) { files.push({ ...file, status: 'excluded', reason: 'sensitive_content' }); excludedCount++; continue; }
      files.push({ ...file, status: 'read', contentSha256: crypto.createHash('sha256').update(bytes).digest('hex'), content });
      readCount++;
    } catch (error) {
      if (error.rateLimited || error instanceof GithubAuthorizationError) throw error;
      files.push({ ...file, status: 'failed', reason: 'blob_unavailable_or_invalid' }); failedCount++;
    }
  }
  return { commitSha, treeSha, files, readCount, attemptedCount, reusedCount, failedCount, excludedCount, unscannedCount, unscannedSubtrees, totalBytes, coverageComplete: failedCount === 0 && unscannedCount === 0 && unscannedSubtrees === 0 };
}
