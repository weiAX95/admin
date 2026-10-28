import crypto from 'node:crypto';
import pg from 'pg';
import { appendSecurityAudit } from './account-audit.mjs';
import { canAccess } from './permissions.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, error) => ({ status, data: { error } });

export async function handleProjectFindingMatches({ pathname, method, client, me, readBody, req }) {
  const route = pathname.match(/^\/api\/project-repositories\/([^/]+)\/analyses\/compare\/([^/]+)\/([^/]+)\/finding-matches(?:\/([^/]+))?$/);
  if (!route) return null;
  const [, repositoryId, olderId, newerId, matchId] = route;
  if (![repositoryId, olderId, newerId, ...(matchId ? [matchId] : [])].every(id => UUID.test(id)) || olderId === newerId) return fail(404, '报告对照不存在');
  if (!((method === 'POST' && !matchId) || (method === 'DELETE' && matchId))) return fail(405, '不支持该操作');
  const body = method === 'POST' ? await readBody() : null;
  const olderFindingId = body?.olderFindingId;
  const newerFindingId = body?.newerFindingId;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (method === 'POST' && (!UUID.test(olderFindingId || '') || !UUID.test(newerFindingId || '') || reason.length < 10 || reason.length > 500)) return fail(400, '请选择两条结论并填写 10–500 字的确认理由');
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    const repository = (await connection.query('SELECT id,owner_id FROM project_repositories WHERE id=$1 AND owner_id=$2', [repositoryId, me.id])).rows[0];
    if (!repository) { await connection.query('ROLLBACK'); return fail(404, '项目不存在'); }
    if (!canAccess(me, 'project_finding_matches', method === 'POST' ? 'create' : 'delete', { ownerId: repository.owner_id })) { await connection.query('ROLLBACK'); return fail(403, '无权管理功能线索对应关系'); }
    if (method === 'DELETE') {
      const removed = (await connection.query('DELETE FROM project_finding_matches WHERE id=$1 AND repository_id=$2 AND older_analysis_id=$3 AND newer_analysis_id=$4 RETURNING id', [matchId, repositoryId, olderId, newerId])).rows[0];
      if (!removed) { await connection.query('ROLLBACK'); return fail(404, '对应关系不存在'); }
      if (req) await appendSecurityAudit(connection, req, me, 'delete', 'project_finding_matches', removed.id);
      await connection.query('COMMIT');
      return { status: 200, data: { removed: true } };
    }
    const rows = (await connection.query(`SELECT a.id,a.branch,a.goal,a.commit_sha,a.finished_at,a.status,s.branch AS scan_branch,s.commit_sha AS scan_commit_sha,s.github_repository_id
      FROM project_analyses a JOIN project_scans s ON s.id=a.scan_id
      WHERE a.repository_id=$1 AND a.id=ANY($2::uuid[])`, [repositoryId, [olderId,newerId]])).rows;
    const older = rows.find(row => row.id === olderId), newer = rows.find(row => row.id === newerId);
    if (!older || !newer || older.status !== 'completed' || newer.status !== 'completed'
      || !(new Date(older.finished_at).getTime() < new Date(newer.finished_at).getTime())
      || !older.github_repository_id || older.github_repository_id !== newer.github_repository_id
      || older.branch !== newer.branch || older.goal !== newer.goal
      || rows.some(row => row.branch !== row.scan_branch || row.commit_sha.trim() !== row.scan_commit_sha.trim())) {
      await connection.query('ROLLBACK'); return fail(409, '两份报告来源不可核对，请重新选择同仓库、分支和目标的可信报告');
    }
    const findings = (await connection.query('SELECT id,analysis_id,requirement_id FROM project_analysis_findings WHERE id=ANY($1::uuid[])', [[olderFindingId,newerFindingId]])).rows;
    if (findings.length !== 2 || !findings.some(row => row.id === olderFindingId && row.analysis_id === olderId && !row.requirement_id)
      || !findings.some(row => row.id === newerFindingId && row.analysis_id === newerId && !row.requirement_id)) {
      await connection.query('ROLLBACK'); return fail(400, '只能确认这两份报告中未关联需求的结论');
    }
    const saved = (await connection.query(`INSERT INTO project_finding_matches(id,repository_id,older_analysis_id,newer_analysis_id,older_finding_id,newer_finding_id,reviewer_id,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,older_finding_id,newer_finding_id,reason,created_at`, [crypto.randomUUID(),repositoryId,olderId,newerId,olderFindingId,newerFindingId,me.id,reason])).rows[0];
    if (req) await appendSecurityAudit(connection, req, me, 'create', 'project_finding_matches', saved.id);
    await connection.query('COMMIT');
    return { status: 201, data: { id: saved.id, olderFindingId: saved.older_finding_id, newerFindingId: saved.newer_finding_id, reason: saved.reason, createdAt: saved.created_at } };
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    if (error.code === '23505') return fail(409, '其中一条结论已确认其他对应关系，请刷新后重试');
    throw error;
  } finally { if (pooled) connection.release(); }
}
