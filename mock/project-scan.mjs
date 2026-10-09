import crypto from 'node:crypto';

const SHA = /^[a-f\d]{40}$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'vendor', 'target', '.venv', '__pycache__']);
const BINARY_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|tar|7z|exe|dll|so|dylib|class|jar|pyc|woff2?|ttf|eot|mp[34]|mov|wav|ogg|avif|bin|db|sqlite)$/i;
const SENSITIVE_NAMES = /(?:^|\/)(?:\.env(?:\.[^/]*)?|id_rsa|id_ed25519|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|service[-_]?account(?:\.[^/]*)?|[^/]+\.(?:pem|key|p12|pfx))$/i;
const SENSITIVE_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b|\b(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*['"]?[^'"\s]{16,}/i;
export const containsKnownSecret = content => SENSITIVE_CONTENT.test(content);

function classification(path) {
  if (/(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|\.)|\.(?:test|spec)\./i.test(path)) return 'test';
  if (/(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING)(?:\.|$)|\.(?:md|mdx|rst)$/i.test(path)) return 'documentation';
  if (/(?:^|\/)(?:package\.json|pyproject\.toml|Cargo\.toml|Dockerfile|vite\.config\.[^/]+)$/i.test(path)) return 'config';
  return 'source';
}

function excludedReason(path, entry, maxFileBytes) {
  const parts = path.split('/');
  if (parts.some(part => SKIP_DIRS.has(part))) return 'dependency_or_build';
  if (SENSITIVE_NAMES.test(path) || parts.some(part => /^(?:secret|secrets|private|credentials)$/i.test(part))) return 'sensitive_path';
  if (entry.mode === '120000' || entry.type !== 'blob') return 'non_regular_file';
  if (BINARY_EXTENSIONS.test(path)) return 'binary_type';
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > maxFileBytes) return 'file_size';
  return null;
}

async function githubFetch(url) {
  return fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-admin-project-analysis', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(10000) });
}

async function getJson(fetchGithub, url) {
  const response = await fetchGithub(url);
  if (!response.ok) throw Object.assign(new Error(`GitHub 读取失败（${response.status}）`), { status: response.status });
  return response.json();
}

export async function scanPublicRepository({ fullName, commitSha, fetchGithub = githubFetch, maxFiles = 200, maxFileBytes = 262144, maxTotalBytes = 5 * 1024 * 1024, maxTreeRequests = 100, maxIndexEntries = 5000 }) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(fullName || '') || !SHA.test(commitSha || '')) throw new Error('仓库或 commit SHA 无效');
  const base = `https://api.github.com/repos/${fullName}/git`;
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
  const files = [];
  let readCount = 0, attemptedCount = 0, failedCount = 0, excludedCount = 0, totalBytes = 0, unscannedCount = Math.max(0, entries.length - maxIndexEntries), rateLimited = false;
  for (const entry of entries.slice(0,maxIndexEntries)) {
    if (typeof entry.path !== 'string' || !SHA.test(entry.sha || '')) { unscannedCount++; continue; }
    const file = { path: entry.path, gitSha: entry.sha, size: Number.isSafeInteger(entry.size) ? entry.size : null, category: classification(entry.path) };
    const reason = entry.skippedTree ? 'dependency_or_build' : excludedReason(entry.path, entry, maxFileBytes);
    if (reason) { files.push({ ...file, status: 'excluded', reason }); excludedCount++; continue; }
    if (rateLimited || attemptedCount >= maxFiles || totalBytes + entry.size > maxTotalBytes) { files.push({ ...file, status: 'unscanned', reason: rateLimited ? 'github_rate_limit' : 'scan_budget' }); unscannedCount++; continue; }
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
      if (error.status === 403 || error.status === 429) rateLimited = true;
      files.push({ ...file, status: 'failed', reason: rateLimited ? 'github_rate_limit' : 'blob_unavailable_or_invalid' }); failedCount++;
    }
  }
  return { commitSha, treeSha, files, readCount, attemptedCount, failedCount, excludedCount, unscannedCount, unscannedSubtrees, totalBytes, coverageComplete: failedCount === 0 && unscannedCount === 0 && unscannedSubtrees === 0 };
}
