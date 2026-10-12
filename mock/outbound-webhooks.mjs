import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

export const WEBHOOK_EVENTS = ['task.completed', 'experiment.finished', 'evaluation.completed', 'alert.firing', 'note.updated'];
const eventSet = new Set(WEBHOOK_EVENTS);
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(address, prefix, 'ipv6');

function keyVersion(env) { return env.WEBHOOK_KEY_VERSION || 'v1'; }
function masterKey(env, version) {
  let encoded = version === keyVersion(env) ? env.WEBHOOK_MASTER_KEY : undefined;
  if (!encoded) {
    try { encoded = JSON.parse(env.WEBHOOK_PREVIOUS_KEYS || '{}')[version]; }
    catch { throw new Error('Webhook 旧密钥配置无效'); }
  }
  if (!/^[a-f\d]{64}$/i.test(encoded || '')) throw new Error('Webhook 加密密钥未配置');
  return Buffer.from(encoded, 'hex');
}
function encrypt(value, id, field, env, version = keyVersion(env)) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(env, version), nonce);
  cipher.setAAD(Buffer.from(`${id}:${field}:${version}`));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { data, nonce, tag: cipher.getAuthTag() };
}
function decrypt(row, field, env) {
  const data = row[`${field}_cipher`];
  if (!data) return field === 'headers' ? '{}' : '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(env, row.key_version), row[`${field}_nonce`]);
  decipher.setAAD(Buffer.from(`${row.id}:${field}:${row.key_version}`));
  decipher.setAuthTag(row[`${field}_tag`]);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
function apiView(row) {
  return { id: row.id, event: row.event_type, url: row.target_url, secretMask: row.secret_mask,
    hasHeaders: Boolean(row.headers_cipher), enabled: row.enabled, version: row.version,
    deletedAt: row.deleted_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
function validateTarget(raw, env = process.env) {
  if (typeof raw !== 'string' || raw.length > 500) throw new Error('Webhook URL 无效');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Webhook URL 无效'); }
  const local = env.ALLOW_LOCAL_WEBHOOKS === '1' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Webhook 仅允许公网 HTTPS；本地测试需显式启用回环地址');
  if (url.username || url.password || url.hash || url.search || !url.hostname || url.href.length > 500) throw new Error('Webhook URL 不得包含凭据、查询或片段');
  return { url, local };
}
function validateHeaders(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 10) throw new Error('自定义请求头无效');
  for (const [name, header] of Object.entries(value)) {
    if (!/^x-(?!webhook-)[a-z0-9-]{1,60}$/i.test(name) || typeof header !== 'string' || !header || header.length > 500 || /[\r\n]/.test(header)) throw new Error('仅允许非保留的 X- 请求头，且内容不得包含换行');
  }
  return value;
}
function validateInput(body, env, current = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('配置内容无效');
  if (!eventSet.has(body.event)) throw new Error('不支持的 Webhook 事件');
  validateTarget(body.url, env);
  if (typeof body.enabled !== 'boolean') throw new Error('启用状态无效');
  if (body.confirmExternalFields !== true) throw new Error('请先确认将要外发的字段');
  if (!current || body.secret !== undefined) {
    if (typeof body.secret !== 'string' || body.secret.length < 16 || body.secret.length > 256) throw new Error('共享密钥须为 16–256 字符');
  }
  if (current && (!Number.isInteger(body.version) || body.version !== current.version)) throw new Error('配置版本已过期');
  validateHeaders(body.headers);
}
function mask(secret) { return `••••${secret.slice(-4)}`; }
function problem(status, error) { return { status, data: { error } }; }

async function handleOutboundWebhooksInner({ pathname, method, client, me, readBody, url, env = process.env }) {
  if (!pathname.startsWith('/api/settings/webhooks')) return null;
  if (me.role !== 'admin') return problem(403, '仅管理员可管理 Webhook');
  if (pathname === '/api/settings/webhooks' && method === 'GET') {
    const rows = (await client.query('SELECT * FROM outbound_webhooks ORDER BY created_at DESC')).rows;
    return { status: 200, data: { items: rows.map(apiView) } };
  }
  if (pathname === '/api/settings/webhooks' && method === 'POST') {
    const body = await readBody();
    validateInput(body, env);
    await resolveWebhookTarget(body.url, env);
    const id = crypto.randomUUID(), version = keyVersion(env), headers = validateHeaders(body.headers);
    const secret = encrypt(body.secret, id, 'secret', env, version);
    const extra = Object.keys(headers).length ? encrypt(JSON.stringify(headers), id, 'headers', env, version) : null;
    const result = await client.query(`INSERT INTO outbound_webhooks(id,event_type,target_url,secret_cipher,secret_nonce,secret_tag,headers_cipher,headers_nonce,headers_tag,key_version,secret_mask,enabled,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [id,body.event,body.url,secret.data,secret.nonce,secret.tag,extra?.data || null,extra?.nonce || null,extra?.tag || null,version,mask(body.secret),body.enabled,me.id]);
    return { status: 201, data: apiView(result.rows[0]) };
  }
  const route = pathname.match(/^\/api\/settings\/webhooks\/([0-9a-f-]{36})(?:\/(deliveries))?$/);
  if (!route) return problem(404, 'Webhook 不存在');
  const id = route[1];
  const current = (await client.query('SELECT * FROM outbound_webhooks WHERE id=$1', [id])).rows[0];
  if (!current) return problem(404, 'Webhook 不存在');
  if (route[2] === 'deliveries' && method === 'GET') {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
    const rows = (await client.query(`SELECT d.id,d.status,d.attempt_count,d.created_at,d.next_attempt_at,d.delivered_at,d.last_error,
      e.id AS event_id,e.event_type,e.payload,e.created_at AS event_at
      FROM outbound_webhook_deliveries d JOIN outbound_webhook_events e ON e.id=d.event_id
      WHERE d.webhook_id=$1 ORDER BY d.created_at DESC,d.id DESC LIMIT $2`, [id,limit])).rows;
    const attempts = rows.length ? (await client.query('SELECT delivery_id,attempt_number,attempted_at,status_code,response_body,error FROM outbound_webhook_attempts WHERE delivery_id=ANY($1) ORDER BY attempt_number', [rows.map(row => row.id)])).rows : [];
    return { status: 200, data: { items: rows.map(row => ({ ...row, attempts: attempts.filter(item => item.delivery_id === row.id) })) } };
  }
  if (current.deleted_at) return problem(404, 'Webhook 已删除');
  if (!route[2] && method === 'PUT') {
    const body = await readBody();
    if (body.version !== current.version) return problem(409, '配置版本已过期');
    validateInput(body, env, current);
    await resolveWebhookTarget(body.url, env);
    const version = body.secret !== undefined || body.headers !== undefined ? keyVersion(env) : current.key_version;
    if (version !== current.key_version && (body.secret === undefined || body.headers === undefined && current.headers_cipher)) throw new Error('轮换加密密钥时请同时重填共享密钥和自定义请求头');
    const secret = body.secret !== undefined ? encrypt(body.secret,id,'secret',env,version) : { data: current.secret_cipher, nonce: current.secret_nonce, tag: current.secret_tag };
    const headers = body.headers === undefined ? { data: current.headers_cipher, nonce: current.headers_nonce, tag: current.headers_tag } : Object.keys(validateHeaders(body.headers)).length ? encrypt(JSON.stringify(body.headers),id,'headers',env,version) : { data: null, nonce: null, tag: null };
    const result = await client.query(`UPDATE outbound_webhooks SET event_type=$2,target_url=$3,secret_cipher=$4,secret_nonce=$5,secret_tag=$6,
      headers_cipher=$7,headers_nonce=$8,headers_tag=$9,key_version=$10,secret_mask=$11,enabled=$12,version=version+1,updated_at=now()
      WHERE id=$1 AND version=$13 RETURNING *`, [id,body.event,body.url,secret.data,secret.nonce,secret.tag,headers.data,headers.nonce,headers.tag,version,body.secret === undefined ? current.secret_mask : mask(body.secret),body.enabled,body.version]);
    if (!result.rowCount) return problem(409, '配置版本已过期');
    if (!body.enabled || body.event !== current.event_type || body.url !== current.target_url) {
      await client.query("UPDATE outbound_webhook_deliveries SET status='cancelled',lease_until=NULL WHERE webhook_id=$1 AND status='pending'", [id]);
    }
    return { status: 200, data: apiView(result.rows[0]) };
  }
  if (!route[2] && method === 'DELETE') {
    const body = await readBody();
    if (body.version !== current.version) return problem(409, '配置版本已过期');
    const deleted = await client.query('UPDATE outbound_webhooks SET deleted_at=now(),enabled=false,version=version+1 WHERE id=$1 AND version=$2 RETURNING id', [id,body.version]);
    if (!deleted.rowCount) return problem(409, '配置版本已过期');
    await client.query("UPDATE outbound_webhook_deliveries SET status='cancelled',lease_until=NULL WHERE webhook_id=$1 AND status='pending'", [id]);
    return { status: 200, data: { deleted: true } };
  }
  return problem(405, '不支持的操作');
}

export async function handleOutboundWebhooks(context) {
  try { return await handleOutboundWebhooksInner(context); }
  catch (error) {
    if (error.code) throw error;
    return problem(error.status || (error.message === 'Webhook 加密密钥未配置' ? 503 : 400), error.message);
  }
}

function localAddress(address) { return address === '127.0.0.1' || address === '::1'; }
function mappedIPv4(address) { return new URL(`http://[${address}]/`).hostname.toLowerCase().startsWith('[::ffff:'); }
export async function resolveWebhookTarget(raw, env = process.env, lookup = dns.lookup) {
  const { url, local } = validateTarget(raw, env);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const records = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(({ address, family }) => !isIP(address) || ![4,6].includes(family) || family === 6 && mappedIPv4(address) || !(local && localAddress(address)) && blocked.check(address, family === 4 ? 'ipv4' : 'ipv6'))) throw new Error('Webhook 目标地址不是可访问的公网地址');
  if (local && records.some(({ address }) => !localAddress(address))) throw new Error('本地 Webhook 只能指向回环地址');
  return { url, address: records[0].address, family: records[0].family };
}
export function signedWebhookHeaders(secret, eventId, event, raw, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { 'X-Webhook-Id': eventId, 'X-Webhook-Event': event, 'X-Webhook-Timestamp': String(timestamp), 'X-Webhook-Signature': `sha256=${signature}` };
}
function redactResponse(body, secret, headers) {
  let text = body.slice(0, 2048);
  for (const value of [secret, ...Object.values(headers)]) if (value) text = text.replaceAll(value, '[REDACTED]');
  return text.replace(/(?:sk-[a-zA-Z0-9_-]{8,}|api[_-]?key\s*[:=]\s*\S+)/gi, '[REDACTED]');
}
export async function postWebhook({ row, event, env = process.env, lookup = dns.lookup }) {
  const { url, address, family } = await resolveWebhookTarget(row.target_url, env, lookup);
  const secret = decrypt(row, 'secret', env), custom = JSON.parse(decrypt(row, 'headers', env));
  const raw = JSON.stringify({ id: event.id, event: event.event_type, occurredAt: event.created_at, data: event.payload });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw), ...custom, ...signedWebhookHeaders(secret,event.id,event.event_type,raw) };
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, { method: 'POST', headers, timeout: 10000, lookup: (_host, _options, callback) => callback(null,address,family) }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { if (body.length < 2048) body += chunk.slice(0,2048-body.length); });
      response.on('end', () => resolve({ statusCode: response.statusCode || 0, responseBody: redactResponse(body,secret,custom) }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Webhook 请求超时')));
    request.on('error', reject);
    request.end(raw);
  });
}

export async function processOutboundWebhooks(pool, env = process.env) {
  const client = await pool.connect();
  let job, fannedOut = 0;
  try {
    await client.query('BEGIN');
    const events = (await client.query('SELECT * FROM outbound_webhook_events WHERE NOT fanned_out ORDER BY created_at LIMIT 30 FOR UPDATE SKIP LOCKED')).rows;
    fannedOut = events.length;
    for (const event of events) {
      await client.query(`INSERT INTO outbound_webhook_deliveries(id,webhook_id,event_id)
        SELECT gen_random_uuid()::text,id,$1 FROM outbound_webhooks WHERE event_type=$2 AND enabled AND deleted_at IS NULL
        ON CONFLICT(webhook_id,event_id) DO NOTHING`, [event.id,event.event_type]);
      await client.query('UPDATE outbound_webhook_events SET fanned_out=true WHERE id=$1', [event.id]);
    }
    const rows = (await client.query(`SELECT d.id AS delivery_id,d.attempt_count,d.webhook_id,e.id AS event_id,e.event_type AS queued_event_type,e.payload,e.created_at AS event_at,
      w.* FROM outbound_webhook_deliveries d JOIN outbound_webhook_events e ON e.id=d.event_id
      JOIN outbound_webhooks w ON w.id=d.webhook_id
      WHERE (d.status='pending' AND d.next_attempt_at<=now()) OR (d.status='sending' AND d.lease_until<=now())
      ORDER BY d.next_attempt_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`)).rows;
    job = rows[0];
    if (job) {
      if (!job.enabled || job.deleted_at) await client.query("UPDATE outbound_webhook_deliveries SET status='cancelled',lease_until=NULL WHERE id=$1", [job.delivery_id]);
      else if (job.attempt_count >= 4) await client.query("UPDATE outbound_webhook_deliveries SET status='failed',lease_until=NULL WHERE id=$1", [job.delivery_id]);
      else await client.query("UPDATE outbound_webhook_deliveries SET status='sending',attempt_count=attempt_count+1,lease_until=now()+interval '30 seconds' WHERE id=$1", [job.delivery_id]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  if (!job || !job.enabled || job.deleted_at || job.attempt_count >= 4) return Boolean(fannedOut || job);
  let result, error;
  try { result = await postWebhook({ row: job, event: { id: job.event_id, event_type: job.queued_event_type, payload: job.payload, created_at: job.event_at }, env }); }
  catch (failure) { error = failure instanceof Error ? failure.message.slice(0,200) : '投递失败'; }
  const status = result?.statusCode || null, success = status !== null && status >= 200 && status < 300;
  const retry = job.attempt_count + 1 < 4;
  const done = await pool.connect();
  try {
    await done.query('BEGIN');
    const owned = await done.query("SELECT 1 FROM outbound_webhook_deliveries WHERE id=$1 AND status='sending' AND attempt_count=$2 FOR UPDATE", [job.delivery_id,job.attempt_count+1]);
    if (owned.rowCount) {
      await done.query(`INSERT INTO outbound_webhook_attempts(delivery_id,attempt_number,status_code,response_body,error)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(delivery_id,attempt_number) DO NOTHING`, [job.delivery_id,job.attempt_count+1,status,result?.responseBody || null,error]);
      await done.query(`UPDATE outbound_webhook_deliveries SET status=$2,lease_until=NULL,
        next_attempt_at=CASE WHEN $2='pending' THEN now()+($3 * interval '1 minute') ELSE next_attempt_at END,
        delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END,last_error=$4 WHERE id=$1`,
        [job.delivery_id,success?'delivered':retry?'pending':'failed',2 ** job.attempt_count,error || (success ? null : `HTTP ${status}`)]);
    }
    await done.query('COMMIT');
  } catch (failure) { await done.query('ROLLBACK'); throw failure; }
  finally { done.release(); }
  return true;
}
