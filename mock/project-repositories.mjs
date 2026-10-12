import crypto from 'node:crypto';
import pg from 'pg';
import { parseProjectRequirements } from './project-analysis-core.mjs';
import { containsKnownSecret } from './project-scan.mjs';

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicRow = row => ({ id: row.id, ownerId: row.owner_id, fullName: row.full_name, url: `https://github.com/${row.full_name}`, branch: row.branch, goal: row.goal, requirementBaseline: row.requirement_baseline, baselineVersionId: row.baseline_version_id || null, commitSha: row.commit_sha.trim(), lastCheckedAt: row.last_checked_at, lastAnalysisAt: row.last_analysis_at || null, lastAnalyzedCommitSha: row.last_analyzed_commit_sha?.trim() || null, createdAt: row.created_at, updatedAt: row.updated_at });
const repositoryQuery = `SELECT r.*, latest.finished_at AS last_analysis_at, latest.commit_sha AS last_analyzed_commit_sha
  FROM project_repositories r LEFT JOIN LATERAL (
    SELECT finished_at, commit_sha FROM project_analyses
    WHERE repository_id=r.id AND status='completed' AND finished_at IS NOT NULL
    ORDER BY finished_at DESC, created_at DESC LIMIT 1
  ) latest ON true`;
const fail = (status, error) => ({ status, data: { error } });

async function currentRequirements(client, baselineVersionId) {
  if (!baselineVersionId) return [];
  const baseline = (await client.query('SELECT content FROM project_requirement_baselines WHERE id=$1', [baselineVersionId])).rows[0];
  return parseProjectRequirements(baseline?.content);
}

async function writeTaskLink(client, repositoryId, me, expectedBaselineVersionId, work) {
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    const repository = (await connection.query('SELECT baseline_version_id FROM project_repositories WHERE id=$1 AND owner_id=$2 FOR SHARE', [repositoryId, me.id])).rows[0];
    if (!repository) { await connection.query('ROLLBACK'); return fail(404, '项目不存在'); }
    if (expectedBaselineVersionId !== undefined && expectedBaselineVersionId !== repository.baseline_version_id) { await connection.query('ROLLBACK'); return fail(409, '需求版本已变化，请刷新任务关联后重试'); }
    const requirements = await currentRequirements(connection, repository.baseline_version_id);
    const result = await work(connection, requirements);
    await connection.query(result.status >= 400 ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) connection.release(); }
}

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
  if (pathname !== '/api/project-repositories' && !/^\/api\/project-repositories\/[0-9a-f-]{36}(?:\/refresh|\/tasks(?:\/[^/]+)?)?$/i.test(pathname)) return null;
  if (pathname === '/api/project-repositories' && method === 'GET') {
    const rows = (await client.query(`${repositoryQuery} WHERE r.owner_id=$1 ORDER BY r.updated_at DESC`, [me.id])).rows;
    return { status: 200, data: { items: rows.map(publicRow) } };
  }
  if (pathname === '/api/project-repositories' && method === 'POST') {
    const body = await readBody();
    let parsed;
    try { parsed = parseGitHubRepository(body?.url); } catch (error) { return fail(400, error.message); }
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    const baseline = typeof body.requirementBaseline === 'string' ? body.requirementBaseline.trim() : '';
    if (!goal || goal.length > 2000 || baseline.length > 200 || containsKnownSecret(goal) || containsKnownSecret(baseline) || (body.branch && !validBranch(body.branch))) return fail(400, '项目目标、需求基线或分支格式无效，且不得包含凭据');
    const resolved = await resolveRepository(fetchGithub, parsed, body.branch);
    if (resolved.error) return resolved.error;
    const { fullName, branch, commitSha } = resolved.data;
    try {
      const row = (await client.query('INSERT INTO project_repositories(id,owner_id,full_name,branch,goal,requirement_baseline,commit_sha) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [crypto.randomUUID(),me.id,fullName,branch,goal,baseline,commitSha])).rows[0];
      return { status: 201, data: publicRow(row) };
    } catch (error) { if (error.code === '23505') return fail(409, '该分支已接入'); throw error; }
  }
  const id = pathname.split('/')[3];
  if (!UUID.test(id)) return fail(404, '项目不存在');
  const row = (await client.query(`${repositoryQuery} WHERE r.id=$1 AND r.owner_id=$2`, [id,me.id])).rows[0];
  if (!row) return fail(404, '项目不存在');
  if (pathname.endsWith('/tasks') && method === 'GET') {
    const items = (await client.query(`SELECT t.id,t.title,t.status,t.progress,t.owner_id AS "ownerId",l.requirement_id AS "requirementId" FROM project_repository_tasks l
      JOIN tasks t ON t.id=l.task_id WHERE l.repository_id=$1 AND t.deleted_at IS NULL ORDER BY l.created_at DESC,t.id`, [id])).rows;
    return { status: 200, data: { items, baselineVersionId: row.baseline_version_id || null, requirements: await currentRequirements(client, row.baseline_version_id) } };
  }
  if (pathname.endsWith('/tasks') && method === 'POST') {
    const body = await readBody();
    const taskId = body?.taskId;
    if (typeof taskId !== 'string' || !taskId || taskId.length > 200) return fail(400, '任务 ID 无效');
    const requirementId = body.requirementId === undefined || body.requirementId === null ? null : body.requirementId;
    if (requirementId !== null && (typeof requirementId !== 'string' || requirementId.length > 64)) return fail(400, '需求 ID 无效');
    return writeTaskLink(client,id,me,body.expectedBaselineVersionId,async (connection, requirements) => {
      if (requirementId && !requirements.some(item => item.id === requirementId)) return fail(400, '需求 ID 不属于当前版本');
      const task = (await connection.query("SELECT id,title,status,progress,owner_id AS \"ownerId\" FROM tasks WHERE id=$1 AND deleted_at IS NULL AND (owner_id=$2 OR $3='admin')", [taskId,me.id,me.role])).rows[0];
      if (!task) return fail(404, '任务不存在或无权关联');
      await connection.query('INSERT INTO project_repository_tasks(repository_id,task_id,linked_by,requirement_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id,taskId,me.id,requirementId]);
      const link = (await connection.query('SELECT requirement_id FROM project_repository_tasks WHERE repository_id=$1 AND task_id=$2', [id,taskId])).rows[0];
      return { status: 200, data: { ...task, requirementId: link.requirement_id } };
    });
  }
  const unlink = pathname.match(/\/tasks\/([^/]+)$/);
  if (unlink && method === 'PATCH') {
    let taskId;
    try { taskId = decodeURIComponent(unlink[1]); } catch { return fail(400, '任务 ID 无效'); }
    const body = await readBody();
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body,'requirementId') || Object.keys(body).some(key => !['requirementId','expectedBaselineVersionId'].includes(key))) return fail(400, '需求对应关系无效');
    const requirementId = body.requirementId;
    if (requirementId !== null && (typeof requirementId !== 'string' || !requirementId || requirementId.length > 64)) return fail(400, '需求 ID 无效');
    return writeTaskLink(client,id,me,body.expectedBaselineVersionId,async (connection, requirements) => {
      if (requirementId && !requirements.some(item => item.id === requirementId)) return fail(400, '需求 ID 不属于当前版本');
      const task = (await connection.query('SELECT t.id,t.title,t.status,t.progress,t.owner_id AS "ownerId" FROM project_repository_tasks l JOIN tasks t ON t.id=l.task_id WHERE l.repository_id=$1 AND l.task_id=$2 AND t.deleted_at IS NULL', [id,taskId])).rows[0];
      if (!task) return fail(404, '关联任务不存在');
      await connection.query('UPDATE project_repository_tasks SET requirement_id=$3 WHERE repository_id=$1 AND task_id=$2', [id,taskId,requirementId]);
      return { status: 200, data: { ...task, requirementId } };
    });
  }
  if (unlink && method === 'DELETE') {
    let taskId;
    try { taskId = decodeURIComponent(unlink[1]); } catch { return fail(400, '任务 ID 无效'); }
    const deleted = await client.query('DELETE FROM project_repository_tasks WHERE repository_id=$1 AND task_id=$2', [id,taskId]);
    return deleted.rowCount ? { status: 200, data: { deleted: true, taskId } } : fail(404, '关联不存在');
  }
  if (method === 'PATCH' && pathname.endsWith(`/${id}`)) {
    const body = await readBody();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['goal','requirementBaseline','expectedGoal','expectedRequirementBaseline','expectedBaselineVersionId'].includes(key))) return fail(400, '项目修改字段无效');
    const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
    const baseline = body.requirementBaseline === undefined ? row.requirement_baseline : typeof body.requirementBaseline === 'string' ? body.requirementBaseline.trim() : null;
    if (!goal || goal.length > 2000 || baseline === null || baseline.length > 200 || containsKnownSecret(goal) || containsKnownSecret(baseline)) return fail(400, '项目目标或需求基线无效，且不得包含凭据');
    if (typeof body.expectedGoal !== 'string' || typeof body.expectedRequirementBaseline !== 'string' || body.expectedBaselineVersionId !== null && (typeof body.expectedBaselineVersionId !== 'string' || !UUID.test(body.expectedBaselineVersionId))) return fail(400, '缺少当前项目版本，请刷新后重试');
    if (row.baseline_version_id && baseline !== row.requirement_baseline) return fail(409, '已有版本化需求文档，请通过新版本修改正文');
    const changed = await client.query(`UPDATE project_repositories SET goal=$3,requirement_baseline=$4,updated_at=now()
      WHERE id=$1 AND owner_id=$2 AND goal=$5 AND requirement_baseline=$6
        AND baseline_version_id IS NOT DISTINCT FROM $7::uuid
        AND (baseline_version_id IS NULL OR requirement_baseline=$4)
      RETURNING *`, [id,me.id,goal,baseline,body.expectedGoal,body.expectedRequirementBaseline,body.expectedBaselineVersionId]);
    if (!changed.rowCount) return fail(409, '项目目标或需求版本已变化，请刷新后重试');
    return { status: 200, data: publicRow({ ...changed.rows[0], last_analysis_at: row.last_analysis_at, last_analyzed_commit_sha: row.last_analyzed_commit_sha }) };
  }
  if (method === 'GET' && pathname.endsWith(`/${id}`)) return { status: 200, data: publicRow(row) };
  if (method === 'POST' && pathname.endsWith('/refresh')) {
    const [owner, repo] = row.full_name.split('/');
    const resolved = await resolveRepository(fetchGithub, { owner, repo, fullName: row.full_name }, row.branch);
    if (resolved.error) return resolved.error;
    const updated = (await client.query('UPDATE project_repositories SET commit_sha=$1,last_checked_at=now(),updated_at=now() WHERE id=$2 AND owner_id=$3 RETURNING *', [resolved.data.commitSha,id,me.id])).rows[0];
    return { status: 200, data: publicRow({ ...updated, last_analysis_at: row.last_analysis_at, last_analyzed_commit_sha: row.last_analyzed_commit_sha }) };
  }
  return fail(405, '不支持该操作');
}
