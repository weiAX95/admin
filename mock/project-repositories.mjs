import crypto from 'node:crypto';

export function parseGitHubRepository(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入有效的 GitHub 仓库地址'); }
  const match = url.pathname.match(/^\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/?$/);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !match) throw new Error('请输入有效的 GitHub 仓库地址');
  const repo = match[2].replace(/\.git$/i, '');
  if (!repo || repo === '.' || repo === '..') throw new Error('请输入有效的 GitHub 仓库地址');
  return { owner: match[1], repo, fullName: `${match[1]}/${repo}` };
}

const validBranch = value => typeof value === 'string' && value.length >= 1 && value.length <= 200 && /^[\w./-]+$/.test(value) && !value.startsWith('/') && !value.endsWith('/') && !value.includes('..') && !value.includes('//');
const publicRow = row => ({ id: row.id, ownerId: row.owner_id, fullName: row.full_name, url: `https://github.com/${row.full_name}`, branch: row.branch, goal: row.goal, requirementBaseline: row.requirement_baseline, commitSha: row.commit_sha.trim(), lastCheckedAt: row.last_checked_at, createdAt: row.created_at, updatedAt: row.updated_at });
const fail = (status, error) => ({ status, data: { error } });

async function githubFetch(url) {
  return fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-admin-project-analysis', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(10000) });
}

async function readGithub(fetchGithub, url) {
  let response;
  try { response = await fetchGithub(url); }
  catch { return { error: fail(502, '无法连接 GitHub，请稍后重试') }; }
  if (response.status === 404) return { error: fail(404, '仓库或分支不存在，或当前无权访问') };
  if (response.status === 409) return { error: fail(422, '仓库尚无提交，暂不能分析') };
  if (response.status === 403 || response.status === 429) return { error: fail(429, 'GitHub 请求受限，请稍后重试') };
  if (!response.ok) return { error: fail(502, `GitHub 返回错误（${response.status}）`) };
  try { return { data: await response.json() }; }
  catch { return { error: fail(502, 'GitHub 返回了无效数据') }; }
}

async function resolveRepository(fetchGithub, parsed, requestedBranch) {
  const base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const repository = await readGithub(fetchGithub, base);
  if (repository.error) return repository;
  const info = repository.data;
  if (info.private !== false) return { error: fail(403, '第一阶段仅支持公开仓库') };
  if (info.empty === true || info.size === 0) return { error: fail(422, '仓库尚无提交，暂不能分析') };
  const branch = requestedBranch || info.default_branch;
  if (!validBranch(branch)) return { error: fail(400, '分支名称无效') };
  const found = await readGithub(fetchGithub, `${base}/branches/${encodeURIComponent(branch)}`);
  if (found.error) return found;
  const sha = found.data?.commit?.sha;
  if (!/^[a-f\d]{40}$/i.test(sha || '')) return { error: fail(422, '分支没有可用的 commit SHA') };
  const fullName = typeof info.full_name === 'string' && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(info.full_name) ? info.full_name : parsed.fullName;
  return { data: { fullName, branch, commitSha: sha } };
}

export async function handleProjectRepositories({ pathname, method, client, me, readBody, fetchGithub = githubFetch }) {
  if (pathname !== '/api/project-repositories' && !/^\/api\/project-repositories\/[0-9a-f-]{36}(?:\/refresh)?$/i.test(pathname)) return null;
  if (pathname === '/api/project-repositories' && method === 'GET') {
    const rows = (await client.query('SELECT * FROM project_repositories WHERE owner_id=$1 ORDER BY updated_at DESC', [me.id])).rows;
    return { status: 200, data: { items: rows.map(publicRow) } };
  }
  if (pathname === '/api/project-repositories' && method === 'POST') {
    const body = await readBody();
    let parsed;
    try { parsed = parseGitHubRepository(body?.url); } catch (error) { return fail(400, error.message); }
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    const baseline = typeof body.requirementBaseline === 'string' ? body.requirementBaseline.trim() : '';
    if (!goal || goal.length > 2000 || baseline.length > 200 || (body.branch && !validBranch(body.branch))) return fail(400, '项目目标、需求基线或分支格式无效');
    const resolved = await resolveRepository(fetchGithub, parsed, body.branch);
    if (resolved.error) return resolved.error;
    const { fullName, branch, commitSha } = resolved.data;
    try {
      const row = (await client.query('INSERT INTO project_repositories(id,owner_id,full_name,branch,goal,requirement_baseline,commit_sha) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [crypto.randomUUID(),me.id,fullName,branch,goal,baseline,commitSha])).rows[0];
      return { status: 201, data: publicRow(row) };
    } catch (error) { if (error.code === '23505') return fail(409, '该分支已接入'); throw error; }
  }
  const id = pathname.split('/')[3];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return fail(404, '项目不存在');
  const row = (await client.query('SELECT * FROM project_repositories WHERE id=$1 AND owner_id=$2', [id,me.id])).rows[0];
  if (!row) return fail(404, '项目不存在');
  if (method === 'GET' && pathname.endsWith(`/${id}`)) return { status: 200, data: publicRow(row) };
  if (method === 'POST' && pathname.endsWith('/refresh')) {
    const [owner, repo] = row.full_name.split('/');
    const resolved = await resolveRepository(fetchGithub, { owner, repo, fullName: row.full_name }, row.branch);
    if (resolved.error) return resolved.error;
    const updated = (await client.query('UPDATE project_repositories SET commit_sha=$1,last_checked_at=now(),updated_at=now() WHERE id=$2 AND owner_id=$3 RETURNING *', [resolved.data.commitSha,id,me.id])).rows[0];
    return { status: 200, data: publicRow(updated) };
  }
  return fail(405, '不支持该操作');
}
