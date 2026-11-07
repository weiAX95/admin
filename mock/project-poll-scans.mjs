import { GithubAuthorizationError } from './project-github-auth.mjs';
import { currentBranchHead, GithubRepositoryIdentityError, queueScan } from './project-github-webhooks.mjs';

let running = false;
export async function processProjectPollScans(pool) {
  if (running) return 0;
  running = true;
  try {
    const due = (await pool.query(`WITH due AS (
      SELECT r.id FROM project_repositories r JOIN users u ON u.id=r.owner_id
      WHERE r.poll_scan_enabled=true AND r.next_poll_at<=now() AND u.status='active'
      ORDER BY r.next_poll_at,r.id LIMIT 10 FOR UPDATE OF r SKIP LOCKED
    ) UPDATE project_repositories r SET next_poll_at=now()+interval '5 minutes'
      FROM due WHERE r.id=due.id RETURNING r.*`)).rows;
    for (const repository of due) {
      try {
        const head = await currentBranchHead(pool,repository);
        if (!head) {
          await pool.query(`UPDATE project_repositories SET last_poll_at=now(),last_poll_error='BRANCH_NOT_FOUND'
            WHERE id=$1 AND branch=$2 AND github_repository_id=$3 AND poll_scan_enabled=true`,
          [repository.id,repository.branch,repository.github_repository_id]);
          continue;
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const current = (await client.query(`SELECT r.*,u.status AS owner_status FROM project_repositories r
            JOIN users u ON u.id=r.owner_id WHERE r.id=$1 FOR UPDATE OF r`,[repository.id])).rows[0];
          if (current?.poll_scan_enabled && current.branch === repository.branch
            && current.github_repository_id === repository.github_repository_id && current.owner_status === 'active'
            && current.commit_sha.trim() === repository.commit_sha.trim()) {
            await queueScan(client,current,head,'poll');
            await client.query('UPDATE project_repositories SET last_poll_at=now(),last_poll_error=NULL WHERE id=$1',[repository.id]);
          }
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
        finally { client.release(); }
      } catch (error) {
        const code = error?.rateLimited ? 'GITHUB_RATE_LIMIT'
          : error instanceof GithubAuthorizationError ? 'GITHUB_AUTH_REQUIRED'
          : error instanceof GithubRepositoryIdentityError ? 'GITHUB_REPOSITORY_IDENTITY_CHANGED'
            : /^GITHUB_HEAD_(?:\d{3}|INVALID)$/.test(error?.message || '') ? error.message : 'POLL_FAILED';
        const retryAfterMs = error?.rateLimited ? Math.min(86_400_000,Math.max(300_000,error.retryAfterMs || 300_000)) : null;
        await pool.query(`UPDATE project_repositories SET last_poll_at=now(),last_poll_error=$4,
          next_poll_at=CASE WHEN $5::integer IS NULL OR NOT poll_scan_enabled THEN next_poll_at
            ELSE now()+($5 * interval '1 millisecond') END
          WHERE id=$1 AND branch=$2 AND github_repository_id=$3`,
        [repository.id,repository.branch,repository.github_repository_id,code,retryAfterMs]);
        if (error instanceof GithubAuthorizationError || error instanceof GithubRepositoryIdentityError) {
          await pool.query(`UPDATE project_repositories SET poll_scan_enabled=false,next_poll_at=NULL,updated_at=now()
            WHERE id=$1 AND poll_scan_enabled=true AND github_repository_id=$2 AND branch=$3`,
          [repository.id,repository.github_repository_id,repository.branch]);
        }
        console.error('[project-poll-scans] repository check failed:',repository.id,code);
      }
    }
    return due.length;
  } finally { running = false; }
}
