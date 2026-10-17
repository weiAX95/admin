import crypto from 'node:crypto';
import pg from 'pg';
import { appendSecurityAudit } from './account-audit.mjs';

const fail = (status, error) => ({ status, data: { error } });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const configured = () => Boolean(process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET && process.env.GITHUB_APP_CALLBACK_URL && /^[a-f\d]{64}$/i.test(process.env.GITHUB_APP_MASTER_KEY || ''));
const keyVersion = () => process.env.GITHUB_APP_KEY_VERSION || 'v1';

function key(version) {
  let encoded = version === keyVersion() ? process.env.GITHUB_APP_MASTER_KEY : undefined;
  if (!encoded) {
    try { encoded = JSON.parse(process.env.GITHUB_APP_PREVIOUS_KEYS || '{}')[version]; }
    catch { throw new Error('GitHub App 旧密钥配置无效'); }
  }
  if (!/^[a-f\d]{64}$/i.test(encoded || '')) throw new Error('GitHub App 加密密钥不可用');
  return Buffer.from(encoded, 'hex');
}

function seal(value, ownerId, field, version) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(version), nonce);
  cipher.setAAD(Buffer.from(`${ownerId}:${field}:${version}`));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { data, nonce, tag: cipher.getAuthTag() };
}

export function openGithubSecret(row, field) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(row.key_version), row[`${field}_nonce`]);
  decipher.setAAD(Buffer.from(`${row.owner_id}:${field}:${row.key_version}`));
  decipher.setAuthTag(row[`${field}_tag`]);
  return Buffer.concat([decipher.update(row[`${field}_cipher`]), decipher.final()]).toString('utf8');
}

async function exchangeCode(code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, redirect_uri: process.env.GITHUB_APP_CALLBACK_URL, code }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('GitHub 授权交换失败');
  const data = await response.json();
  if (data.error || typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0 || !Number.isFinite(Number(data.refresh_token_expires_in)) || Number(data.refresh_token_expires_in) <= 0) throw new Error('GitHub App 必须启用会过期的用户令牌');
  return data;
}

export async function completeProjectGithubAuthorization(client, params) {
  const state = params.get('state');
  const code = params.get('code');
  if (!state || !/^[a-f\d]{64}$/i.test(state) || !code || code.length > 500 || !configured()) return false;
  const claim = (await client.query('SELECT owner_id FROM project_github_oauth_states WHERE state_hash=$1 AND expires_at>now()', [hash(state)])).rows[0];
  if (!claim) return false;
  const tokens = await exchangeCode(code);
  const identityResponse = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'agent-admin-project-analysis', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(10000),
  });
  if (!identityResponse.ok) throw new Error('无法验证 GitHub 授权账号');
  const identity = await identityResponse.json();
  if (!Number.isSafeInteger(identity.id) || typeof identity.login !== 'string' || !identity.login) throw new Error('GitHub 账号信息无效');
  const version = keyVersion();
  const access = seal(tokens.access_token, claim.owner_id, 'access', version);
  const refresh = seal(tokens.refresh_token, claim.owner_id, 'refresh', version);
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    const consumed = await connection.query('DELETE FROM project_github_oauth_states WHERE state_hash=$1 AND owner_id=$2 AND expires_at>now() RETURNING owner_id', [hash(state),claim.owner_id]);
    if (!consumed.rowCount) { await connection.query('ROLLBACK'); return false; }
    await connection.query(`INSERT INTO project_github_connections(owner_id,github_user_id,github_login,access_cipher,access_nonce,access_tag,refresh_cipher,refresh_nonce,refresh_tag,access_expires_at,refresh_expires_at,key_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+($10 * interval '1 second'),now()+($11 * interval '1 second'),$12)
    ON CONFLICT(owner_id) DO UPDATE SET github_user_id=excluded.github_user_id,github_login=excluded.github_login,
      access_cipher=excluded.access_cipher,access_nonce=excluded.access_nonce,access_tag=excluded.access_tag,
      refresh_cipher=excluded.refresh_cipher,refresh_nonce=excluded.refresh_nonce,refresh_tag=excluded.refresh_tag,
      access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,key_version=excluded.key_version,updated_at=now()`,
    [claim.owner_id,identity.id,identity.login,access.data,access.nonce,access.tag,refresh.data,refresh.nonce,refresh.tag,Number(tokens.expires_in),Number(tokens.refresh_token_expires_in),version]);
    await connection.query('COMMIT');
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) connection.release(); }
  return true;
}

export async function handleProjectGithubAuth({ pathname, method, client, me, req }) {
  if (!pathname.startsWith('/api/project-github')) return null;
  if (pathname === '/api/project-github' && method === 'GET') {
    const row = (await client.query('SELECT github_login,access_expires_at,refresh_expires_at FROM project_github_connections WHERE owner_id=$1', [me.id])).rows[0];
    return { status: 200, data: { configured: configured(), connected: Boolean(row), githubLogin: row?.github_login || null, accessExpiresAt: row?.access_expires_at || null, refreshExpiresAt: row?.refresh_expires_at || null } };
  }
  if (pathname === '/api/project-github/start' && method === 'POST') {
    if (!configured()) return fail(503, 'GitHub App 尚未配置');
    let callback;
    try { callback = new URL(process.env.GITHUB_APP_CALLBACK_URL); }
    catch { return fail(503, 'GitHub App 回调地址无效'); }
    if (callback.protocol !== 'https:' && !(callback.protocol === 'http:' && ['localhost','127.0.0.1'].includes(callback.hostname))) return fail(503, 'GitHub App 回调地址必须使用 HTTPS');
    const state = crypto.randomBytes(32).toString('hex');
    await client.query('DELETE FROM project_github_oauth_states WHERE expires_at<=now()');
    await client.query('INSERT INTO project_github_oauth_states(state_hash,owner_id,expires_at) VALUES($1,$2,now()+interval \'10 minutes\')', [hash(state),me.id]);
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({ client_id: process.env.GITHUB_APP_CLIENT_ID, redirect_uri: callback.toString(), state }).toString();
    if (req) await appendSecurityAudit(client,req,me,'github_authorization.started','project_github_connections',me.id);
    return { status: 200, data: { url: url.toString() } };
  }
  if (pathname === '/api/project-github' && method === 'DELETE') {
    const pooled = client instanceof pg.Pool;
    const connection = pooled ? await client.connect() : client;
    try {
      await connection.query('BEGIN');
      await connection.query('DELETE FROM project_github_oauth_states WHERE owner_id=$1', [me.id]);
      await connection.query('DELETE FROM project_github_connections WHERE owner_id=$1', [me.id]);
      if (req) await appendSecurityAudit(connection,req,me,'github_authorization.disconnected','project_github_connections',me.id);
      await connection.query('COMMIT');
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { if (pooled) connection.release(); }
    return { status: 200, data: { connected: false } };
  }
  return fail(405, '不支持该操作');
}
