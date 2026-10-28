import crypto from 'node:crypto';
import pg from 'pg';
import { scanPublicRepository } from './project-scan.mjs';
import { projectImpactPriorityPathsV15 } from './project-analysis-impact.mjs';
import { compareProjectScanFiles } from './project-scan-changes.mjs';
import { appendSecurityAudit } from './account-audit.mjs';
import { canAccess } from './permissions.mjs';
import { assertGithubPrivateRepoAccess, githubUserFetch, GithubAuthorizationError } from './project-github-auth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status,error) => ({ status, data: { error } });
const view = row => ({ id: row.id, repositoryId: row.repository_id, githubRepositoryId: row.github_repository_id === null ? null : Number(row.github_repository_id), fullName: row.full_name, branch: row.branch, commitSha: row.commit_sha.trim(), treeSha: row.tree_sha?.trim() || null, status: row.status, coverageComplete: row.coverage_complete, forceFull: row.force_full, triggerSource: row.trigger_source || 'manual', autoAnalysisState: row.auto_analysis_state || 'none', autoAnalysisError: row.auto_analysis_error || null, autoAnalysisId: row.auto_analysis_id || null, baselineCommitSha: row.baseline_commit_sha?.trim() || null, budgetFileLimit: row.budget_file_limit, budgetByteLimit: row.budget_byte_limit, readCount: row.read_count, attemptedCount: row.attempted_count, reusedCount: row.reused_count, cacheSourceCommitSha: row.cache_source_commit_sha?.trim() || null, excludedCount: row.excluded_count, failedCount: row.failed_count, unscannedCount: row.unscanned_count, unscannedSubtrees: row.unscanned_subtrees, totalBytes: Number(row.total_bytes), retryCount: row.retry_count, nextAttemptAt: row.next_attempt_at, errorCode: row.error_code, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at });
const fileView = row => ({ path: row.path, gitSha: row.git_sha.trim(), size: row.byte_size === null ? null : Number(row.byte_size), category: row.category, status: row.status, reason: row.reason, contentSha256: row.content_sha256?.trim() || null });
let runTail = Promise.resolve();
const scheduled = new Set();
function enqueue(db, id, scanRepository) {
  if (scheduled.has(id)) return runTail;
  scheduled.add(id);
  const current = runTail.then(() => runProjectScan(db,id,scanRepository)).finally(() => scheduled.delete(id));
  runTail = current.catch(() => undefined);
  return current;
}

async function saveResult(db, id, result, source, changes, privateOwnerId = null) {
  const pooled = db instanceof pg.Pool;
  const client = pooled ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    if (privateOwnerId && !(await client.query('SELECT 1 FROM project_github_connections WHERE owner_id=$1 FOR SHARE', [privateOwnerId])).rowCount) throw new GithubAuthorizationError('GitHub App 授权已断开');
    await client.query('DELETE FROM project_scan_files WHERE scan_id=$1', [id]);
    for (const file of result.files) {
      await client.query('INSERT INTO project_scan_files(scan_id,path,git_sha,byte_size,category,status,reason,content_sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id,file.path,file.gitSha,file.size,file.category,file.status,file.reason || null,file.contentSha256 || null,file.content ?? null]);
    }
    await client.query('DELETE FROM project_scan_changes WHERE scan_id=$1', [id]);
    for (const [position, change] of changes.entries()) await client.query('INSERT INTO project_scan_changes(scan_id,position,change_kind,path,old_path,old_git_sha,new_git_sha) VALUES($1,$2,$3,$4,$5,$6,$7)', [id,position,change.kind,change.path,change.oldPath,change.oldGitSha,change.newGitSha]);
    await client.query('UPDATE project_scans SET tree_sha=$2,status=$3,coverage_complete=$4,baseline_scan_id=$5,baseline_commit_sha=$6,read_count=$7,attempted_count=$8,reused_count=$9,cache_source_commit_sha=$10,excluded_count=$11,failed_count=$12,unscanned_count=$13,unscanned_subtrees=$14,total_bytes=$15,error_code=NULL,next_attempt_at=NULL,finished_at=now() WHERE id=$1', [id,result.treeSha,result.coverageComplete ? 'completed' : 'partial',result.coverageComplete,source?.id || null,source?.commit_sha?.trim() || null,result.readCount,result.attemptedCount,result.reusedCount || 0,result.reusedCount ? result.cacheSourceCommitSha : null,result.excludedCount,result.failedCount,result.unscannedCount,result.unscannedSubtrees,result.totalBytes]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { if (pooled) client.release(); }
}

export async function runProjectScan(db, id, scanRepository = scanPublicRepository) {
  const pooled = db instanceof pg.Pool;
  const lockClient = pooled ? await db.connect() : db;
  let locked = false;
  try {
    locked = (await lockClient.query('SELECT pg_try_advisory_lock(748207) AS locked')).rows[0].locked;
    if (!locked) return;
    const claimed = await db.query("UPDATE project_scans SET status='scanning',started_at=now(),next_attempt_at=NULL,error_code=NULL WHERE id=$1 AND (status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=now()) OR status='scanning') RETURNING id,repository_id,full_name,branch,commit_sha,github_repository_id,created_at,budget_file_limit,budget_byte_limit,force_full,retry_count", [id]);
    if (!claimed.rowCount) return;
    const job = claimed.rows[0];
    try {
    const repository = (await db.query('SELECT owner_id,full_name,is_private,github_repository_id FROM project_repositories WHERE id=$1', [job.repository_id])).rows[0];
    if (!repository) throw new Error('REPOSITORY_MISSING');
    if (repository.github_repository_id === null || job.github_repository_id === null || repository.github_repository_id !== job.github_repository_id) throw Object.assign(new Error('仓库身份尚未核对或已变化'),{ code: 'GITHUB_REPOSITORY_IDENTITY_REQUIRED' });
    if (repository.is_private) await assertGithubPrivateRepoAccess(db,repository.owner_id,repository.full_name,repository.github_repository_id);
    const source = (await db.query("SELECT id,commit_sha,coverage_complete FROM project_scans WHERE repository_id=$1 AND id<>$2 AND created_at<$3 AND github_repository_id=$4 AND branch=$5 AND status IN ('completed','partial') ORDER BY created_at DESC,id DESC LIMIT 1", [job.repository_id,id,job.created_at,job.github_repository_id,job.branch])).rows[0];
    const sourceFiles = source ? (await db.query('SELECT path,git_sha,category,status,content FROM project_scan_files WHERE scan_id=$1 ORDER BY path LIMIT 5000',[source.id])).rows.map(row => ({ path: row.path, gitSha: row.git_sha.trim(), category: row.category, status: row.status, content: row.content })) : null;
    const cachedBlobs = new Map();
    if (source && !job.force_full && !repository.is_private) {
      const rows = (await db.query("SELECT git_sha,content_sha256,content FROM project_scan_files WHERE scan_id=$1 AND status='read' AND content IS NOT NULL AND content_sha256 IS NOT NULL LIMIT 5000", [source.id])).rows;
      for (const row of rows) cachedBlobs.set(row.git_sha.trim().toLowerCase(),{ content: row.content, contentSha256: row.content_sha256.trim() });
    }
    const fetchGithub = repository.is_private ? async url => {
      const response = await githubUserFetch(db,repository.owner_id,url);
      if (response.status === 404 || response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') !== '0' && !response.headers?.get?.('retry-after')) throw new GithubAuthorizationError('GitHub App 已失去仓库读取权限');
      return response;
    } : undefined;
    const result = await scanRepository({ fullName: job.full_name, commitSha: job.commit_sha.trim(), expectedRepositoryId: repository.github_repository_id, fetchGithub, cachedBlobs, previousFiles: sourceFiles || [], previousCoverageComplete: Boolean(source?.coverage_complete), relatedPathsForChanges: sourceFiles ? changes => projectImpactPriorityPathsV15(sourceFiles,changes) : null, maxFiles: job.budget_file_limit, maxTotalBytes: job.budget_byte_limit });
    if (result.commitSha !== job.commit_sha.trim()) throw new Error('COMMIT_MISMATCH');
    if (repository.is_private) await assertGithubPrivateRepoAccess(db,repository.owner_id,repository.full_name,repository.github_repository_id);
    result.cacheSourceCommitSha = source?.commit_sha?.trim() || null;
    const changes = compareProjectScanFiles(sourceFiles,result.files);
    await saveResult(db,id,result,source,changes,repository.is_private ? repository.owner_id : null);
    } catch (error) {
      if (error.rateLimited && job.retry_count < 3) {
        const delay = Math.min(86_400_000,Math.max(60_000,error.retryAfterMs || 60_000) * 2 ** job.retry_count);
        await db.query("UPDATE project_scans SET status='queued',coverage_complete=false,error_code='GITHUB_RATE_LIMIT',retry_count=retry_count+1,next_attempt_at=$2,finished_at=NULL WHERE id=$1 AND status='scanning'", [id,new Date(Date.now() + delay)]);
      } else {
        const errorCode = error.rateLimited ? 'GITHUB_RATE_LIMIT' : error instanceof GithubAuthorizationError ? 'GITHUB_AUTH_REQUIRED'
          : error.code === 'GITHUB_REPOSITORY_IDENTITY_CHANGED' || error.code === 'GITHUB_REPOSITORY_IDENTITY_REQUIRED' ? error.code
            : error.message === 'COMMIT_MISMATCH' ? 'COMMIT_MISMATCH' : 'SCAN_FAILED';
        await db.query("UPDATE project_scans SET status='failed',coverage_complete=false,error_code=$2,next_attempt_at=NULL,finished_at=now(),auto_analysis_state=CASE WHEN auto_analysis_state='pending' THEN 'skipped' ELSE auto_analysis_state END,auto_analysis_error=CASE WHEN auto_analysis_state='pending' THEN '扫描失败，未启动自动分析' ELSE auto_analysis_error END WHERE id=$1 AND status='scanning'", [id,errorCode]);
      }
    }
  } finally {
    if (locked) await lockClient.query('SELECT pg_advisory_unlock(748207)').catch(() => undefined);
    if (pooled) lockClient.release();
  }
}

export async function resumeProjectScans(db, scanRepository = scanPublicRepository, recoverScanning = true) {
  const jobs = (await db.query("SELECT id FROM project_scans WHERE (status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=now())) OR (status='scanning' AND ($1 OR started_at<now()-interval '2 minutes')) ORDER BY created_at LIMIT 50",[recoverScanning])).rows;
  for (const job of jobs) void enqueue(db,job.id,scanRepository);
  return jobs.length;
}

export async function handleProjectScans({ pathname, method, client, me, url, readBody, scanRepository = scanPublicRepository, req }) {
  const match = pathname.match(/^\/api\/project-repositories\/([^/]+)\/scans(?:\/([^/]+)(\/files)?)?$/);
  if (!match) return null;
  const [, repositoryId, scanId, fileRoute] = match;
  if (!UUID.test(repositoryId) || scanId && !UUID.test(scanId)) return fail(404,'项目或扫描不存在');
  const repository = (await client.query('SELECT * FROM project_repositories WHERE id=$1 AND owner_id=$2', [repositoryId,me.id])).rows[0];
  if (!repository) return fail(404,'项目不存在');
  const operation = method === 'POST' && !scanId ? 'create' : 'read';
  if (!canAccess(me,'project_scans',operation,{ownerId:repository.owner_id})) return fail(403,'无权访问仓库扫描');
  if (method === 'GET' && !scanId) {
    const rows = (await client.query('SELECT * FROM project_scans WHERE repository_id=$1 ORDER BY created_at DESC LIMIT 20', [repositoryId])).rows;
    return { status: 200, data: { items: rows.map(view) } };
  }
  if (method === 'GET' && scanId && fileRoute) {
    const path = url?.searchParams.get('path');
    if (!path || path.length > 1000) return fail(400,'文件路径无效');
    const file = (await client.query("SELECT f.path,f.git_sha,f.content_sha256,f.content FROM project_scan_files f JOIN project_scans s ON s.id=f.scan_id WHERE s.id=$1 AND s.repository_id=$2 AND f.path=$3 AND f.status='read'", [scanId,repositoryId,path])).rows[0];
    if (!file || file.content === null) return fail(404,'文件内容不存在');
    return { status: 200, data: { path: file.path, gitSha: file.git_sha.trim(), contentSha256: file.content_sha256?.trim() || null, content: file.content } };
  }
  if (method === 'GET' && scanId && !fileRoute) {
    const scan = (await client.query('SELECT * FROM project_scans WHERE id=$1 AND repository_id=$2', [scanId,repositoryId])).rows[0];
    if (!scan) return fail(404,'扫描不存在');
    const files = (await client.query('SELECT * FROM project_scan_files WHERE scan_id=$1 ORDER BY path LIMIT 5000', [scanId])).rows;
    const changes = (await client.query('SELECT change_kind,path,old_path,old_git_sha,new_git_sha FROM project_scan_changes WHERE scan_id=$1 ORDER BY position LIMIT 10000',[scanId])).rows.map(row => ({ kind: row.change_kind, path: row.path, oldPath: row.old_path, oldGitSha: row.old_git_sha?.trim() || null, newGitSha: row.new_git_sha?.trim() || null }));
    return { status: 200, data: { ...view(scan), files: files.map(fileView), changes } };
  }
  if (method === 'POST' && !scanId) {
    if (repository.github_repository_id === null) return fail(409,'请先核对并绑定此项目的 GitHub 仓库身份');
    const body = readBody ? await readBody() : {};
    const budgetFileLimit = body?.budgetFileLimit ?? 200;
    const budgetByteLimit = body?.budgetByteLimit ?? 5242880;
    const requestedForceFull = body?.forceFull ?? false;
    if (!body || typeof body !== 'object' || Array.isArray(body) || ![50,100,200,500].includes(budgetFileLimit) || ![1048576,5242880,10485760].includes(budgetByteLimit) || typeof requestedForceFull !== 'boolean') return fail(400,'扫描预算或模式无效');
    const forceFull = repository.is_private || requestedForceFull;
    const id = crypto.randomUUID();
    const pooled = client instanceof pg.Pool;
    const connection = pooled ? await client.connect() : client;
    try {
      await connection.query('BEGIN');
      const current = (await connection.query('SELECT github_repository_id,branch,commit_sha FROM project_repositories WHERE id=$1 AND owner_id=$2 FOR SHARE',[repositoryId,me.id])).rows[0];
      if (!current || !current.github_repository_id || current.github_repository_id !== repository.github_repository_id || current.branch !== repository.branch || current.commit_sha.trim() !== repository.commit_sha.trim()) {
        await connection.query('ROLLBACK');
        return fail(409,'仓库身份、分支或 commit 已变化，请刷新项目后重新扫描');
      }
      await connection.query("INSERT INTO project_scans(id,repository_id,full_name,branch,commit_sha,github_repository_id,budget_file_limit,budget_byte_limit,force_full,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued')", [id,repositoryId,repository.full_name,repository.branch,repository.commit_sha,repository.github_repository_id,budgetFileLimit,budgetByteLimit,forceFull]);
      if (req) await appendSecurityAudit(connection,req,me,'create','project_scans',id,{repositoryId,commitSha:repository.commit_sha.trim(),budgetFileLimit,budgetByteLimit,forceFull});
      await connection.query('COMMIT');
    }
    catch (error) {
      await connection.query('ROLLBACK').catch(() => undefined);
      if (error.code !== '23505') throw error;
      const active = (await client.query("SELECT * FROM project_scans WHERE repository_id=$1 AND branch=$2 AND commit_sha=$3 AND status IN ('queued','scanning') ORDER BY created_at LIMIT 1", [repositoryId,repository.branch,repository.commit_sha])).rows[0];
      return active && active.force_full === forceFull ? { status: 202, data: view(active) } : fail(409,'同一 commit 已有不同模式的扫描任务，请稍后重试');
    }
    finally { if (pooled) connection.release(); }
    void enqueue(client,id,scanRepository);
    return { status: 202, data: view((await client.query('SELECT * FROM project_scans WHERE id=$1', [id])).rows[0]) };
  }
  return fail(405,'不支持该操作');
}
