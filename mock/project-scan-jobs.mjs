import crypto from 'node:crypto';
import pg from 'pg';
import { scanPublicRepository } from './project-scan.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status,error) => ({ status, data: { error } });
const view = row => ({ id: row.id, repositoryId: row.repository_id, fullName: row.full_name, branch: row.branch, commitSha: row.commit_sha.trim(), treeSha: row.tree_sha?.trim() || null, status: row.status, coverageComplete: row.coverage_complete, readCount: row.read_count, attemptedCount: row.attempted_count, excludedCount: row.excluded_count, failedCount: row.failed_count, unscannedCount: row.unscanned_count, unscannedSubtrees: row.unscanned_subtrees, totalBytes: Number(row.total_bytes), errorCode: row.error_code, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at });
const fileView = row => ({ path: row.path, gitSha: row.git_sha.trim(), size: row.byte_size === null ? null : Number(row.byte_size), category: row.category, status: row.status, reason: row.reason, contentSha256: row.content_sha256?.trim() || null });
let runTail = Promise.resolve();
function enqueue(db, id, scanRepository) {
  const current = runTail.then(() => runProjectScan(db,id,scanRepository));
  runTail = current.catch(() => undefined);
  return current;
}

async function saveResult(db, id, result) {
  const pooled = db instanceof pg.Pool;
  const client = pooled ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM project_scan_files WHERE scan_id=$1', [id]);
    for (const file of result.files) {
      await client.query('INSERT INTO project_scan_files(scan_id,path,git_sha,byte_size,category,status,reason,content_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id,file.path,file.gitSha,file.size,file.category,file.status,file.reason || null,file.contentSha256 || null]);
    }
    await client.query('UPDATE project_scans SET tree_sha=$2,status=$3,coverage_complete=$4,read_count=$5,attempted_count=$6,excluded_count=$7,failed_count=$8,unscanned_count=$9,unscanned_subtrees=$10,total_bytes=$11,error_code=NULL,finished_at=now() WHERE id=$1', [id,result.treeSha,result.coverageComplete ? 'completed' : 'partial',result.coverageComplete,result.readCount,result.attemptedCount,result.excludedCount,result.failedCount,result.unscannedCount,result.unscannedSubtrees,result.totalBytes]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { if (pooled) client.release(); }
}

export async function runProjectScan(db, id, scanRepository = scanPublicRepository) {
  const job = (await db.query('SELECT id,full_name,commit_sha FROM project_scans WHERE id=$1', [id])).rows[0];
  if (!job) return;
  try {
    await db.query("UPDATE project_scans SET status='scanning',started_at=COALESCE(started_at,now()),error_code=NULL WHERE id=$1", [id]);
    const result = await scanRepository({ fullName: job.full_name, commitSha: job.commit_sha.trim() });
    if (result.commitSha !== job.commit_sha.trim()) throw new Error('COMMIT_MISMATCH');
    await saveResult(db,id,result);
  } catch (error) {
    const errorCode = error.status === 403 || error.status === 429 ? 'GITHUB_RATE_LIMIT' : error.message === 'COMMIT_MISMATCH' ? 'COMMIT_MISMATCH' : 'SCAN_FAILED';
    await db.query("UPDATE project_scans SET status='failed',coverage_complete=false,error_code=$2,finished_at=now() WHERE id=$1", [id,errorCode]);
  }
}

export async function resumeProjectScans(db, scanRepository = scanPublicRepository) {
  const jobs = (await db.query("SELECT id FROM project_scans WHERE status IN ('queued','scanning') ORDER BY created_at")).rows;
  for (const job of jobs) void enqueue(db,job.id,scanRepository);
  return jobs.length;
}

export async function handleProjectScans({ pathname, method, client, me, scanRepository = scanPublicRepository }) {
  const match = pathname.match(/^\/api\/project-repositories\/([^/]+)\/scans(?:\/([^/]+))?$/);
  if (!match) return null;
  const [, repositoryId, scanId] = match;
  if (!UUID.test(repositoryId) || scanId && !UUID.test(scanId)) return fail(404,'项目或扫描不存在');
  const repository = (await client.query('SELECT * FROM project_repositories WHERE id=$1 AND owner_id=$2', [repositoryId,me.id])).rows[0];
  if (!repository) return fail(404,'项目不存在');
  if (method === 'GET' && !scanId) {
    const rows = (await client.query('SELECT * FROM project_scans WHERE repository_id=$1 ORDER BY created_at DESC LIMIT 20', [repositoryId])).rows;
    return { status: 200, data: { items: rows.map(view) } };
  }
  if (method === 'GET' && scanId) {
    const scan = (await client.query('SELECT * FROM project_scans WHERE id=$1 AND repository_id=$2', [scanId,repositoryId])).rows[0];
    if (!scan) return fail(404,'扫描不存在');
    const files = (await client.query('SELECT * FROM project_scan_files WHERE scan_id=$1 ORDER BY path LIMIT 5000', [scanId])).rows;
    return { status: 200, data: { ...view(scan), files: files.map(fileView) } };
  }
  if (method === 'POST' && !scanId) {
    const id = crypto.randomUUID();
    try { await client.query("INSERT INTO project_scans(id,repository_id,full_name,branch,commit_sha,status) VALUES($1,$2,$3,$4,$5,'queued')", [id,repositoryId,repository.full_name,repository.branch,repository.commit_sha]); }
    catch (error) {
      if (error.code !== '23505') throw error;
      const active = (await client.query("SELECT * FROM project_scans WHERE repository_id=$1 AND commit_sha=$2 AND status IN ('queued','scanning') ORDER BY created_at LIMIT 1", [repositoryId,repository.commit_sha])).rows[0];
      return active ? { status: 202, data: view(active) } : fail(409,'扫描任务正在变化，请重试');
    }
    void enqueue(client,id,scanRepository);
    return { status: 202, data: view((await client.query('SELECT * FROM project_scans WHERE id=$1', [id])).rows[0]) };
  }
  return fail(405,'不支持该操作');
}
