import { notifyUser } from './app-notifications.mjs';

const windowStart = () => new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
const retryAfter = () => Math.max(1, Math.ceil((60000 - Date.now() % 60000) / 1000));

export async function handleModelRateLimits({ pathname, method, client, me, readBody }) {
  if (pathname !== '/api/model-rate-limits' && pathname !== '/api/model-rate-status') return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可管理模型速率限制' } };
  if (pathname === '/api/model-rate-status' && method === 'GET') {
    const rows = (await client.query(`SELECT l.model_id,m.display_name,l.rpm,l.tpm,
      COALESCE(SUM(r.reserved_requests),0)::bigint AS used_requests,
      COALESCE(SUM(r.reserved_tokens),0)::bigint AS used_tokens
      FROM model_rate_limits l JOIN experiment_models m ON m.id=l.model_id
      LEFT JOIN model_rate_reservations r ON r.model_id=l.model_id AND r.window_start=date_trunc('minute',now())
      GROUP BY l.model_id,m.display_name,l.rpm,l.tpm ORDER BY m.display_name`)).rows;
    return { status: 200, data: { windowStart: windowStart(), retryAfterSeconds: retryAfter(), items: rows.map(row => ({ modelId: row.model_id, modelName: row.display_name, rpm: row.rpm, tpm: Number(row.tpm), usedRequests: Number(row.used_requests), usedTokens: Number(row.used_tokens), remainingRequests: Math.max(0,row.rpm-Number(row.used_requests)), remainingTokens: Math.max(0,Number(row.tpm)-Number(row.used_tokens)) })) } };
  }
  if (pathname !== '/api/model-rate-limits') return null;
  if (method === 'GET') {
    const rows = (await client.query('SELECT l.model_id,m.display_name,l.rpm,l.tpm FROM model_rate_limits l JOIN experiment_models m ON m.id=l.model_id ORDER BY m.display_name')).rows;
    return { status: 200, data: { items: rows.map(row => ({ modelId: row.model_id, modelName: row.display_name, rpm: row.rpm, tpm: Number(row.tpm) })) } };
  }
  if (method !== 'PUT' && method !== 'DELETE') return null;
  const body = await readBody();
  if (typeof body?.modelId !== 'string' || !(await client.query('SELECT 1 FROM experiment_models WHERE id=$1', [body.modelId])).rowCount) return { status: 404, data: { error: '模型不存在' } };
  if (method === 'DELETE') { await client.query('DELETE FROM model_rate_limits WHERE model_id=$1', [body.modelId]); return { status: 200, data: { deleted: true } }; }
  if (!Number.isSafeInteger(body.rpm) || body.rpm < 1 || body.rpm > 1_000_000 || !Number.isSafeInteger(body.tpm) || body.tpm < 1 || body.tpm > 1_000_000_000) return { status: 400, data: { error: 'RPM 须为 1–1,000,000；TPM 须为 1–1,000,000,000' } };
  await client.query('INSERT INTO model_rate_limits(model_id,rpm,tpm) VALUES($1,$2,$3) ON CONFLICT(model_id) DO UPDATE SET rpm=EXCLUDED.rpm,tpm=EXCLUDED.tpm,updated_at=now()', [body.modelId,body.rpm,body.tpm]);
  return { status: 200, data: { modelId: body.modelId, rpm: body.rpm, tpm: body.tpm } };
}

export async function checkModelRate(client, requests) {
  const requested = new Map();
  for (const item of requests) {
    const previous = requested.get(item.modelId) || { calls: 0, tokens: 0 };
    requested.set(item.modelId, { calls: previous.calls + item.calls, tokens: previous.tokens + item.tokens });
  }
  if (!requested.size) return { status: 200, items: [] };
  await client.query('SELECT pg_advisory_xact_lock(748203)');
  const minute = windowStart(), items = [];
  for (const [modelId, request] of requested) {
    const limit = (await client.query('SELECT rpm,tpm FROM model_rate_limits WHERE model_id=$1', [modelId])).rows[0];
    const used = (await client.query('SELECT COALESCE(sum(reserved_requests),0)::bigint AS calls,COALESCE(sum(reserved_tokens),0)::bigint AS tokens FROM model_rate_reservations WHERE model_id=$1 AND window_start=$2', [modelId,minute])).rows[0];
    const calls = Number(used.calls), tokens = Number(used.tokens);
    if (limit && (calls + request.calls > limit.rpm || tokens + request.tokens > Number(limit.tpm))) return { status: 429, data: { error: '模型分钟速率限制', modelId, rpm: limit.rpm, tpm: Number(limit.tpm), usedRequests: calls, usedTokens: tokens, requestedRequests: request.calls, requestedTokens: request.tokens, retryAfterSeconds: retryAfter() } };
    items.push({ modelId, minute, calls, tokens, request, limit });
  }
  return { status: 200, items };
}

export async function reserveModelRate(client, runRequests, checked) {
  await client.query("DELETE FROM model_rate_reservations WHERE window_start < date_trunc('minute',now())-interval '2 minutes'");
  const minute = checked.items[0]?.minute;
  for (const item of runRequests) await client.query('INSERT INTO model_rate_reservations(run_id,model_id,window_start,reserved_requests,reserved_tokens) VALUES($1,$2,$3,$4,$5)', [item.runId,item.modelId,minute,item.calls,item.tokens]);
  for (const item of checked.items) {
    if (!item.limit) continue;
    const before = Math.max(item.calls/item.limit.rpm,item.tokens/Number(item.limit.tpm));
    const after = Math.max((item.calls+item.request.calls)/item.limit.rpm,(item.tokens+item.request.tokens)/Number(item.limit.tpm));
    if (before <= .9 && after > .9) {
      for (const admin of (await client.query("SELECT id FROM users WHERE role='admin' AND status='active'")).rows) await notifyUser(client,admin.id,'model_rate_near_limit',`${item.modelId}:${minute}`,`模型 ${item.modelId} 接近速率上限`,`本分钟已预留 ${item.calls+item.request.calls}/${item.limit.rpm} 次请求、${item.tokens+item.request.tokens}/${item.limit.tpm} token。`,'/experiments');
    }
  }
}
