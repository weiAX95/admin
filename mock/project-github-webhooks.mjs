import crypto from 'node:crypto';
import pg from 'pg';
import { assertGithubPrivateRepoAccess, GithubAuthorizationError, githubUserFetch } from './project-github-auth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 4;
let processingDeliveries = false;
class GithubRepositoryIdentityError extends Error {}

async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('GitHub 事件超过大小限制'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validSignature(body, signature, secret) {
  if (typeof secret !== 'string' || !secret || typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const supplied = Buffer.from(signature.slice(7),'hex');
  const expected = crypto.createHmac('sha256',secret).update(body).digest();
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied,expected);
}

async function currentBranchHead(pool, repository) {
  const base = `https://api.github.com/repos/${repository.full_name}`;
  const info = repository.is_private
    ? await assertGithubPrivateRepoAccess(pool,repository.owner_id,repository.full_name,repository.github_repository_id)
    : await (async () => {
      const response = await fetch(base,{ headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-admin-project-analysis', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`GITHUB_HEAD_${response.status}`);
      return response.json();
    })();
  if (info.id !== Number(repository.github_repository_id) || info.private !== repository.is_private) throw new GithubRepositoryIdentityError('仓库身份已变化');
  const canonicalName = typeof info.full_name === 'string' && REPOSITORY.test(info.full_name) ? info.full_name : repository.full_name;
  const url = `https://api.github.com/repos/${canonicalName}/branches/${encodeURIComponent(repository.branch)}`;
  const response = repository.is_private
    ? await githubUserFetch(pool,repository.owner_id,url)
    : await fetch(url,{ headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-admin-project-analysis', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GITHUB_HEAD_${response.status}`);
  const sha = (await response.json())?.commit?.sha;
  if (!SHA.test(sha || '')) throw new Error('GITHUB_HEAD_INVALID');
  return sha.toLowerCase();
}

async function queueScan(client, repository, commitSha) {
  await client.query('UPDATE project_repositories SET commit_sha=$2,last_checked_at=now(),updated_at=now() WHERE id=$1',[repository.id,commitSha]);
  const previous = await client.query("SELECT 1 FROM project_scans WHERE repository_id=$1 AND commit_sha=$2 AND github_repository_id=$3 AND status IN ('queued','scanning','completed','partial') LIMIT 1",[repository.id,commitSha,repository.github_repository_id]);
  if (previous.rowCount) return 0;
  const queuedScan = (await client.query(`SELECT id FROM project_scans WHERE repository_id=$1 AND github_repository_id=$2 AND trigger_source='webhook' AND status='queued'
    AND created_at>now()-interval '2 minutes' ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE SKIP LOCKED`,[repository.id,repository.github_repository_id])).rows[0];
  if (queuedScan) {
    await client.query('SAVEPOINT webhook_coalesce_scan');
    try {
      const updated = await client.query("UPDATE project_scans SET commit_sha=$2,auto_analysis_state=$3,auto_analysis_error=NULL WHERE id=$1 AND status='queued' RETURNING id",[queuedScan.id,commitSha,repository.auto_analysis_enabled ? 'pending' : 'none']);
      await client.query('RELEASE SAVEPOINT webhook_coalesce_scan');
      if (updated.rowCount) return 1;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT webhook_coalesce_scan');
      await client.query('RELEASE SAVEPOINT webhook_coalesce_scan');
      if (error.code !== '23505') throw error;
      const duplicate = await client.query("SELECT 1 FROM project_scans WHERE repository_id=$1 AND commit_sha=$2 AND github_repository_id=$3 AND status IN ('queued','scanning','completed','partial') LIMIT 1",[repository.id,commitSha,repository.github_repository_id]);
      if (duplicate.rowCount) return 0;
    }
  }
  const queued = await client.query(`INSERT INTO project_scans(id,repository_id,full_name,branch,commit_sha,force_full,trigger_source,auto_analysis_state,github_repository_id,status)
    VALUES($1,$2,$3,$4,$5,$6,'webhook',$7,$8,'queued') ON CONFLICT DO NOTHING RETURNING id`,[crypto.randomUUID(),repository.id,repository.full_name,repository.branch,commitSha,repository.is_private,repository.auto_analysis_enabled ? 'pending' : 'none',repository.github_repository_id]);
  return queued.rowCount;
}

export async function handleProjectGithubWebhook(req, pool, env = process.env) {
  if (req.method !== 'POST') return { status: 405, data: { error: '仅接受 POST' } };
  if (!env.GITHUB_APP_WEBHOOK_SECRET) return { status: 503, data: { error: 'GitHub Webhook 尚未配置' } };
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) return { status: 415, data: { error: '需要 JSON 请求体' } };
  const deliveryId = req.headers['x-github-delivery'];
  const eventType = req.headers['x-github-event'];
  if (!UUID.test(String(deliveryId || '')) || typeof eventType !== 'string' || !/^[a-z_]{1,40}$/.test(eventType)) return { status: 400, data: { error: 'GitHub 事件标识无效' } };
  let body;
  try { body = await rawBody(req); }
  catch (error) { return { status: error.status || 400, data: { error: error.message } }; }
  if (!validSignature(body,req.headers['x-hub-signature-256'],env.GITHUB_APP_WEBHOOK_SECRET)) return { status: 401, data: { error: 'GitHub 签名无效' } };
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); }
  catch { return { status: 400, data: { error: 'GitHub 事件不是有效 JSON' } }; }
  const fullName = payload?.repository?.full_name;
  const payloadRepositoryId = payload?.repository?.id;
  const branch = eventType === 'push' && typeof payload.ref === 'string' && payload.ref.startsWith('refs/heads/') ? payload.ref.slice('refs/heads/'.length) : null;
  const commitSha = eventType === 'push' && branch && payload.deleted !== true && SHA.test(payload.after || '') && !/^0+$/.test(payload.after) ? payload.after.toLowerCase() : null;
  if (eventType === 'push' && branch && payload.deleted !== true && (!REPOSITORY.test(fullName || '') || branch.length > 200 || !commitSha || !Number.isSafeInteger(payloadRepositoryId) || payloadRepositoryId <= 0)) return { status: 400, data: { error: 'GitHub push 内容无效' } };
  const pooled = pool instanceof pg.Pool;
  const client = pooled ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    const eligible = eventType === 'push' && Boolean(commitSha);
    const inserted = await client.query(`INSERT INTO project_github_webhook_deliveries(delivery_id,event_type,repository_full_name,branch,commit_sha,payload_repository_id,processing_state,processed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7='completed' THEN now() ELSE NULL END)
      ON CONFLICT DO NOTHING RETURNING delivery_id`,[deliveryId,eventType,REPOSITORY.test(fullName || '') ? fullName : null,branch,commitSha,Number.isSafeInteger(payloadRepositoryId) && payloadRepositoryId > 0 ? payloadRepositoryId : null,eligible ? 'queued' : 'completed']);
    if (!inserted.rowCount) {
      const requeued = await client.query(`UPDATE project_github_webhook_deliveries SET processing_state='queued',attempts=0,
        next_attempt_at=NULL,started_at=NULL,processed_at=NULL,last_error=NULL WHERE delivery_id=$1 AND processing_state='failed' RETURNING delivery_id`,[deliveryId]);
      await client.query('COMMIT');
      return { status: 200, data: { received: true, duplicate: true, processing: Boolean(requeued.rowCount), scansQueued: 0 } };
    }
    await client.query('COMMIT');
    return { status: 202, data: { received: true, duplicate: false, processing: eligible, scansQueued: 0 } };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) client.release(); }
}

async function claimDelivery(pool) {
  return (await pool.query(`WITH candidate AS (
    SELECT delivery_id FROM project_github_webhook_deliveries
    WHERE attempts < $1 AND (processing_state='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=now())
      OR processing_state='processing' AND started_at<now()-interval '2 minutes')
    ORDER BY received_at,delivery_id LIMIT 1 FOR UPDATE SKIP LOCKED
  ) UPDATE project_github_webhook_deliveries d SET processing_state='processing',attempts=d.attempts+1,
    started_at=now(),next_attempt_at=NULL FROM candidate WHERE d.delivery_id=candidate.delivery_id RETURNING d.*`,[MAX_ATTEMPTS])).rows[0];
}

async function applyDelivery(pool, delivery, resolveHead) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = (await client.query("SELECT * FROM project_github_webhook_deliveries WHERE delivery_id=$1 FOR UPDATE",[delivery.delivery_id])).rows[0];
    if (!current || current.processing_state !== 'processing' || current.attempts !== delivery.attempts) { await client.query('ROLLBACK'); return; }
    const repositories = (await client.query(`SELECT id,owner_id,full_name,branch,is_private,github_repository_id,auto_analysis_enabled
      FROM project_repositories WHERE github_repository_id=$1 AND branch=$2 AND webhook_scan_enabled=true
      ORDER BY id FOR UPDATE`,[delivery.payload_repository_id,delivery.branch])).rows;
    let scansQueued = 0, resolvedHead = null, inaccessible = 0, mismatched = 0;
    const publicHeads = new Map();
    for (const repository of repositories) {
      let head;
      try {
        if (!repository.is_private && publicHeads.has(repository.full_name.toLowerCase())) head = publicHeads.get(repository.full_name.toLowerCase());
        else {
          head = await resolveHead(pool,repository);
          if (!repository.is_private) publicHeads.set(repository.full_name.toLowerCase(),head);
        }
      }
      catch (error) {
        if (!(error instanceof GithubAuthorizationError) && !(error instanceof GithubRepositoryIdentityError)) throw error;
        if (error instanceof GithubAuthorizationError) inaccessible++;
        else mismatched++;
        await client.query('UPDATE project_repositories SET webhook_scan_enabled=false,auto_analysis_enabled=false,updated_at=now() WHERE id=$1',[repository.id]);
        continue;
      }
      if (!head) continue;
      if (!SHA.test(head)) throw new Error('GITHUB_HEAD_INVALID');
      resolvedHead = head.toLowerCase();
      scansQueued += await queueScan(client,repository,resolvedHead);
    }
    await client.query(`UPDATE project_github_webhook_deliveries SET processing_state='completed',scan_count=$2,
      resolved_commit_sha=$3,processed_at=now(),last_error=$4 WHERE delivery_id=$1`,
    [delivery.delivery_id,scansQueued,resolvedHead,[inaccessible ? `PRIVATE_ACCESS_LOST:${inaccessible}` : null,mismatched ? `REPOSITORY_IDENTITY_MISMATCH:${mismatched}` : null].filter(Boolean).join(',') || null]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function processProjectGithubDeliveries(pool, resolveHead = currentBranchHead) {
  if (processingDeliveries) return;
  processingDeliveries = true;
  try {
    await pool.query(`UPDATE project_github_webhook_deliveries SET processing_state='failed',last_error='WORKER_INTERRUPTED',
      processed_at=now() WHERE processing_state='processing' AND attempts >= $1 AND started_at<now()-interval '2 minutes'`,[MAX_ATTEMPTS]);
    for (let index = 0; index < 20; index++) {
      const delivery = await claimDelivery(pool);
      if (!delivery) break;
      try { await applyDelivery(pool,delivery,resolveHead); }
      catch (error) {
        const exhausted = delivery.attempts >= MAX_ATTEMPTS;
        const delaySeconds = 60 * 2 ** (delivery.attempts - 1);
        const errorCode = error?.rateLimited ? 'GITHUB_RATE_LIMIT'
          : /^GITHUB_HEAD_(?:\d{3}|INVALID)$/.test(error?.message || '') ? error.message
            : 'DELIVERY_PROCESSING_FAILED';
        await pool.query(`UPDATE project_github_webhook_deliveries SET processing_state=$3,
          next_attempt_at=CASE WHEN $4 THEN NULL ELSE now()+($5 * interval '1 second') END,
          last_error=$6,processed_at=CASE WHEN $4 THEN now() ELSE NULL END
          WHERE delivery_id=$1 AND processing_state='processing' AND attempts=$2`,
        [delivery.delivery_id,delivery.attempts,exhausted ? 'failed' : 'queued',exhausted,delaySeconds,errorCode]);
      }
    }
  } finally { processingDeliveries = false; }
}
