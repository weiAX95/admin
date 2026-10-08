import crypto from 'node:crypto';
import { sha256 } from './postgres-store.mjs';
import { regressionReport } from './experiment-evaluation.mjs';

const ok = (data, status = 200) => ({ status, data });
const fail = (error, status = 400) => ok({ error }, status);
const expiries = { '1h': 3600_000, '24h': 86400_000, '7d': 604800_000, permanent: null };
const uuid = () => crypto.randomUUID();
const publicRoute = /^\/api\/public\/evaluation-reports\/([0-9a-f-]{36})$/;

async function ownedBatch(client, batchId, me) {
  const row = (await client.query("SELECT id,owner_id FROM experiment_batches WHERE id=$1 AND kind='regression'", [batchId])).rows[0];
  if (!row) return { error: fail('回归报告不存在', 404) };
  if (me.role !== 'admin' && row.owner_id !== me.id) return { error: fail('无权管理此报告分享', 403) };
  return { row };
}

export async function handlePublicEvaluationReport({ pathname, method, client }) {
  const match = pathname.match(publicRoute);
  if (!match || method !== 'GET') return null;
  const share = (await client.query('SELECT * FROM evaluation_report_shares WHERE token_hash=$1', [sha256(match[1])])).rows[0];
  if (!share) return fail('分享链接不存在', 404);
  if (share.revoked_at) return fail('分享已撤销', 410);
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) return fail('分享已过期', 410);
  const report = await regressionReport(client, share.batch_id);
  return report.status === 200 ? ok({ report: report.data, expiresAt: share.expires_at }) : report;
}

export async function handleEvaluationReportSharing({ pathname, method, client, me, readBody }) {
  const preview = pathname.match(/^\/api\/evaluation\/reports\/([^/]+)\/share-preview$/);
  if (preview && method === 'GET') {
    const { error } = await ownedBatch(client, preview[1], me);
    return error || regressionReport(client, preview[1]);
  }
  const list = pathname.match(/^\/api\/evaluation\/reports\/([^/]+)\/shares$/);
  if (list) {
    const { error } = await ownedBatch(client, list[1], me);
    if (error) return error;
    if (method === 'GET') return ok({ items: (await client.query('SELECT id,expires_at,revoked_at,created_at FROM evaluation_report_shares WHERE batch_id=$1 ORDER BY created_at DESC', [list[1]])).rows });
    if (method === 'POST') {
      const body = await readBody();
      if (!Object.hasOwn(expiries, body.expiry)) return fail('分享期限无效');
      const token = uuid(), id = uuid();
      const expiresAt = expiries[body.expiry] === null ? null : new Date(Date.now() + expiries[body.expiry]).toISOString();
      await client.query('INSERT INTO evaluation_report_shares(id,batch_id,created_by,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)', [id,list[1],me.id,sha256(token),expiresAt]);
      return ok({ id, token, path: `/share/evaluation-reports/${token}`, expiresAt }, 201);
    }
  }
  const revoke = pathname.match(/^\/api\/evaluation\/report-shares\/([^/]+)\/revoke$/);
  if (revoke && method === 'POST') {
    const row = (await client.query('SELECT s.id,s.batch_id FROM evaluation_report_shares s WHERE s.id=$1', [revoke[1]])).rows[0];
    if (!row) return fail('分享不存在', 404);
    const { error } = await ownedBatch(client, row.batch_id, me);
    if (error) return error;
    await client.query('UPDATE evaluation_report_shares SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1', [row.id]);
    return ok({ revoked: true });
  }
  return null;
}

export async function canReadSharedEvaluationMedia(pool, token, assetId) {
  if (!/^[0-9a-f-]{36}$/.test(token || '') || !/^[0-9a-f-]{36}$/.test(assetId || '')) return false;
  const row = (await pool.query('SELECT batch_id FROM evaluation_report_shares WHERE token_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())', [sha256(token)])).rows[0];
  if (!row) return false;
  const caseLink = await pool.query('SELECT 1 FROM experiment_runs r JOIN evaluation_case_assets a ON a.case_id=r.case_id WHERE r.batch_id=$1 AND a.asset_id=$2 LIMIT 1', [row.batch_id,assetId]);
  if (caseLink.rowCount) return true;
  const outputs = (await pool.query('SELECT output_parts FROM experiment_runs WHERE batch_id=$1', [row.batch_id])).rows;
  return outputs.some(({ output_parts: parts }) => Array.isArray(parts) && parts.some(part => part.assetId === assetId));
}
