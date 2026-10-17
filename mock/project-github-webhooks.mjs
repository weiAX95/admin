import crypto from 'node:crypto';
import pg from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/;
const MAX_BODY_BYTES = 1024 * 1024;

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
  const branch = eventType === 'push' && typeof payload.ref === 'string' && payload.ref.startsWith('refs/heads/') ? payload.ref.slice('refs/heads/'.length) : null;
  const commitSha = eventType === 'push' && branch && payload.deleted !== true && SHA.test(payload.after || '') && !/^0+$/.test(payload.after) ? payload.after.toLowerCase() : null;
  if (eventType === 'push' && branch && payload.deleted !== true && (!REPOSITORY.test(fullName || '') || branch.length > 200 || !commitSha)) return { status: 400, data: { error: 'GitHub push 内容无效' } };
  const pooled = pool instanceof pg.Pool;
  const client = pooled ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`INSERT INTO project_github_webhook_deliveries(delivery_id,event_type,repository_full_name,branch,commit_sha)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING delivery_id`,[deliveryId,eventType,REPOSITORY.test(fullName || '') ? fullName : null,branch,commitSha]);
    if (!inserted.rowCount) { await client.query('COMMIT'); return { status: 200, data: { received: true, duplicate: true, scansQueued: 0 } }; }
    let scansQueued = 0;
    if (eventType === 'push' && commitSha) {
      const repositories = (await client.query(`SELECT id,owner_id,full_name,branch,is_private,commit_sha FROM project_repositories
        WHERE lower(full_name)=lower($1) AND branch=$2 AND webhook_scan_enabled=true ORDER BY id FOR UPDATE`,[fullName,branch])).rows;
      for (const repository of repositories) {
        await client.query('UPDATE project_repositories SET commit_sha=$2,last_checked_at=now(),updated_at=now() WHERE id=$1',[repository.id,commitSha]);
        const previous = await client.query("SELECT 1 FROM project_scans WHERE repository_id=$1 AND commit_sha=$2 AND status IN ('queued','scanning','completed','partial') LIMIT 1",[repository.id,commitSha]);
        if (previous.rowCount) continue;
        const queued = await client.query(`INSERT INTO project_scans(id,repository_id,full_name,branch,commit_sha,force_full,status)
          VALUES($1,$2,$3,$4,$5,$6,'queued') ON CONFLICT DO NOTHING RETURNING id`,[crypto.randomUUID(),repository.id,repository.full_name,repository.branch,commitSha,repository.is_private]);
        scansQueued += queued.rowCount;
      }
    }
    await client.query('UPDATE project_github_webhook_deliveries SET scan_count=$2 WHERE delivery_id=$1',[deliveryId,scansQueued]);
    await client.query('COMMIT');
    return { status: 202, data: { received: true, duplicate: false, scansQueued } };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) client.release(); }
}
