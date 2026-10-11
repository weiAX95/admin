import crypto from 'node:crypto';
import pg from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = new Set(['implemented','partial','not_found','unverified']);
const fail = (status,error) => ({ status, data: { error } });

export async function handleProjectFindingFeedback({ pathname, method, client, me, readBody }) {
  const match = pathname.match(/^\/api\/project-repositories\/([^/]+)\/analyses\/([^/]+)\/findings\/([^/]+)\/feedback$/);
  if (!match) return null;
  if (method !== 'POST') return fail(405,'不支持该操作');
  const [,repositoryId,analysisId,findingId] = match;
  if (![repositoryId,analysisId,findingId].every(value => UUID.test(value))) return fail(404,'结论不存在');
  const body = await readBody();
  const status = body?.correctedStatus;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!statuses.has(status) || reason.length < 10 || reason.length > 1000) return fail(400,'请选择修正状态，并填写 10–1000 字的理由');
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    const finding = (await connection.query(`SELECT f.id FROM project_analysis_findings f
      JOIN project_analyses a ON a.id=f.analysis_id
      JOIN project_repositories r ON r.id=a.repository_id
      WHERE f.id=$1 AND a.id=$2 AND r.id=$3 AND r.owner_id=$4 AND a.status='completed'`,[findingId,analysisId,repositoryId,me.id])).rows[0];
    if (!finding) { await connection.query('ROLLBACK'); return fail(404,'结论不存在'); }
    const result = (await connection.query('INSERT INTO project_finding_feedback(id,analysis_id,finding_id,owner_id,corrected_status,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,corrected_status,reason,created_at',[crypto.randomUUID(),analysisId,findingId,me.id,status,reason])).rows[0];
    await connection.query('COMMIT');
    return { status: 201, data: { id: result.id, correctedStatus: result.corrected_status, reason: result.reason, createdAt: result.created_at, author: me.username || me.id } };
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) connection.release(); }
}
