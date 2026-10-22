import pg from 'pg';
import { appendSecurityAudit } from './account-audit.mjs';
import { assertGithubPrivateRepoAccess, GithubAuthorizationError } from './project-github-auth.mjs';
import { isAdministrator } from './roles.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, error) => ({ status, data: { error } });

async function privateAccess(client, me, repository) {
  if (!repository.is_private) return null;
  if (repository.github_repository_id === null) return fail(409,'项目仓库身份尚未核对，请所属账号先完成核对');
  try { await assertGithubPrivateRepoAccess(client,me.id,repository.full_name,repository.github_repository_id); return null; }
  catch (error) {
    return error instanceof GithubAuthorizationError
      ? fail(403,'请先授权此私有仓库的 GitHub 读取权限')
      : fail(502,'暂时无法核验 GitHub 私有仓库权限');
  }
}

export async function handleProjectLearningReviews({ pathname, method, client, me, url, readBody, req }) {
  const match = pathname.match(/^\/api\/project-learning-reviews(?:\/([^/]+))?$/);
  if (!match) return null;
  if (!isAdministrator(me)) return fail(403,'仅管理员可核验学习记录');
  const evidenceId = match[1];
  if (!evidenceId && method === 'GET') {
    const repositoryId = url.searchParams.get('repositoryId');
    if (repositoryId !== null && !UUID.test(repositoryId)) return fail(400,'项目 ID 无效');
    const page = Number(url.searchParams.get('page') || 1);
    if (!Number.isInteger(page) || page < 1 || page > 1000) return fail(400,'页码无效');
    if (repositoryId) {
      const repository = (await client.query('SELECT id,full_name,is_private,github_repository_id FROM project_repositories WHERE id=$1',[repositoryId])).rows[0];
      if (!repository) return fail(404,'项目不存在');
      const denied = await privateAccess(client,me,repository);
      if (denied) return denied;
    }
    const rows = (await client.query(`SELECT review.evidence_id,review.requested_at,
      e.repository_id,e.analysis_id,e.suggestion_id,e.kind,e.response,e.artifact_url,e.created_at,
      r.full_name,r.is_private,s.topic,s.practice,s.acceptance
      FROM project_learning_evidence_reviews review
      JOIN project_learning_evidence e ON e.id=review.evidence_id
      JOIN project_repositories r ON r.id=e.repository_id
      JOIN project_analysis_suggestions s ON s.id=e.suggestion_id
      WHERE review.state='pending' AND e.owner_id<>$1
        AND ($2::uuid IS NOT NULL AND e.repository_id=$2 OR $2::uuid IS NULL AND r.is_private=false)
      ORDER BY review.requested_at,review.evidence_id LIMIT 51 OFFSET $3`,[me.id,repositoryId,(page-1)*50])).rows;
    return { status: 200, data: { items: rows.slice(0,50).map(row => ({
      evidenceId: row.evidence_id, repositoryId: row.repository_id, analysisId: row.analysis_id,
      suggestionId: row.suggestion_id, repositoryName: row.full_name, private: row.is_private,
      kind: row.kind, response: row.response, artifactUrl: row.artifact_url,
      submittedAt: row.created_at, requestedAt: row.requested_at,
      topic: row.topic, practice: row.practice, acceptance: row.acceptance,
    })), page, hasMore: rows.length > 50 } };
  }
  if (!evidenceId || method !== 'POST') return fail(405,'不支持该操作');
  if (!UUID.test(evidenceId)) return fail(404,'学习记录不存在');
  const body = await readBody();
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 3 || typeof body.coreCorrect !== 'boolean'
    || typeof body.boundaryVerified !== 'boolean' || typeof body.rationale !== 'string'
    || Array.from(body.rationale.trim()).length < 20 || Array.from(body.rationale.trim()).length > 2000) {
    return fail(400,'请按两项标准核验并填写 20–2000 字理由');
  }
  const evidence = (await client.query(`SELECT e.id,e.owner_id,e.repository_id,r.full_name,r.is_private,r.github_repository_id
    FROM project_learning_evidence e JOIN project_repositories r ON r.id=e.repository_id
    WHERE e.id=$1`,[evidenceId])).rows[0];
  if (!evidence) return fail(404,'学习记录不存在');
  if (evidence.owner_id === me.id) return fail(403,'不能核验本人提交的学习记录');
  const denied = await privateAccess(client,me,evidence);
  if (denied) return denied;
  const state = body.coreCorrect && body.boundaryVerified ? 'verified' : 'needs_revision';
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    if (evidence.is_private) {
      const currentRepository = (await connection.query('SELECT github_repository_id FROM project_repositories WHERE id=$1 FOR SHARE',[evidence.repository_id])).rows[0];
      if (!currentRepository?.github_repository_id || currentRepository.github_repository_id !== evidence.github_repository_id
        || !(await connection.query('SELECT 1 FROM project_github_connections WHERE owner_id=$1 FOR SHARE',[me.id])).rowCount) {
        await connection.query('ROLLBACK');
        return fail(403,'私有仓库身份或授权已变化，请刷新后重试');
      }
    }
    const reviewed = (await connection.query(`UPDATE project_learning_evidence_reviews
      SET state=$2,reviewer_id=$3,core_correct=$4,boundary_verified=$5,rationale=$6,reviewed_at=now()
      WHERE evidence_id=$1 AND owner_id<>$3 AND state='pending'
      RETURNING evidence_id,state,reviewer_id,core_correct,boundary_verified,rationale,reviewed_at`,
    [evidenceId,state,me.id,body.coreCorrect,body.boundaryVerified,body.rationale.trim()])).rows[0];
    if (!reviewed) { await connection.query('ROLLBACK'); return fail(409,'审核请求已处理或不存在，请刷新'); }
    if (req) await appendSecurityAudit(connection,req,me,'review',
      'project_learning_evidence_reviews',evidenceId,{ repositoryId: evidence.repository_id, state });
    await connection.query('COMMIT');
    return { status: 200, data: { evidenceId, state: reviewed.state, reviewedAt: reviewed.reviewed_at } };
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) connection.release(); }
}
