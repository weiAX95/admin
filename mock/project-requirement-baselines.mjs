import crypto from 'node:crypto';
import pg from 'pg';
import { containsKnownSecret } from './project-scan.mjs';
import { appendSecurityAudit } from './account-audit.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status,error) => ({ status, data: { error } });
const view = row => ({ id: row.id, repositoryId: row.repository_id, version: row.version, contentSha256: row.content_sha256.trim(), createdAt: row.created_at, ...(row.content === undefined ? {} : { content: row.content }) });

export async function handleProjectRequirementBaselines({ pathname, method, client, me, readBody, req }) {
  const match = pathname.match(/^\/api\/project-repositories\/([^/]+)\/baselines(?:\/([^/]+))?$/);
  if (!match) return null;
  const [,repositoryId,baselineId] = match;
  if (!UUID.test(repositoryId) || baselineId && !UUID.test(baselineId)) return fail(404,'需求文档不存在');
  if (method === 'GET') {
    const owner = (await client.query('SELECT id FROM project_repositories WHERE id=$1 AND owner_id=$2',[repositoryId,me.id])).rows[0];
    if (!owner) return fail(404,'项目不存在');
    if (baselineId) {
      const row = (await client.query('SELECT * FROM project_requirement_baselines WHERE id=$1 AND repository_id=$2',[baselineId,repositoryId])).rows[0];
      return row ? { status: 200, data: view(row) } : fail(404,'需求文档不存在');
    }
    const rows = (await client.query('SELECT id,repository_id,version,content_sha256,created_at FROM project_requirement_baselines WHERE repository_id=$1 ORDER BY version DESC LIMIT 50',[repositoryId])).rows;
    return { status: 200, data: { items: rows.map(view) } };
  }
  if (method !== 'POST' || baselineId) return fail(405,'不支持该操作');
  const body = await readBody();
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  const expected = body?.currentVersionId === null ? null : body?.currentVersionId;
  if (!content || content.length > 5000 || containsKnownSecret(content) || expected !== null && !UUID.test(expected || '')) return fail(400,'需求正文无效、过长或包含已知凭据格式');
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    const repository = (await connection.query('SELECT baseline_version_id FROM project_repositories WHERE id=$1 AND owner_id=$2 FOR UPDATE',[repositoryId,me.id])).rows[0];
    if (!repository) { await connection.query('ROLLBACK'); return fail(404,'项目不存在'); }
    if (repository.baseline_version_id !== expected) { await connection.query('ROLLBACK'); return fail(409,'需求文档已有新版本，请刷新后重试'); }
    const next = (await connection.query('SELECT COALESCE(max(version),0)+1 AS version FROM project_requirement_baselines WHERE repository_id=$1',[repositoryId])).rows[0].version;
    const id = crypto.randomUUID();
    const sha = crypto.createHash('sha256').update(content).digest('hex');
    const row = (await connection.query('INSERT INTO project_requirement_baselines(id,repository_id,version,content,content_sha256) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,repositoryId,next,content,sha])).rows[0];
    await connection.query('UPDATE project_repositories SET baseline_version_id=$2,requirement_baseline=$3,updated_at=now() WHERE id=$1',[repositoryId,id,`需求文档 v${next}`]);
    if (req) await appendSecurityAudit(connection,req,me,'create','project_requirement_baselines',id,{repositoryId,version:next});
    await connection.query('COMMIT');
    return { status: 201, data: view(row) };
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) connection.release(); }
}
