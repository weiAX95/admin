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

export class GithubAuthorizationError extends Error {
  constructor(message) { super(message); this.name = 'GithubAuthorizationError'; }
}

export async function getGithubUserToken(client, ownerId) {
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query('BEGIN');
    const row = (await connection.query('SELECT * FROM project_github_connections WHERE owner_id=$1 FOR UPDATE', [ownerId])).rows[0];
    if (!row) { await connection.query('ROLLBACK'); throw new GithubAuthorizationError('请先连接 GitHub 账号'); }
    if (new Date(row.refresh_expires_at).getTime() <= Date.now()) {
      await connection.query('DELETE FROM project_github_connections WHERE owner_id=$1', [ownerId]);
      await connection.query('COMMIT');
      throw new GithubAuthorizationError('GitHub 授权已过期，请重新连接');
    }
    if (new Date(row.access_expires_at).getTime() > Date.now() + 60_000) {
      const token = openGithubSecret(row, 'access');
      await connection.query('COMMIT');
      return { token, accessTag: row.access_tag };
    }
    let response;
    try {
      response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: openGithubSecret(row, 'refresh') }),
        signal: AbortSignal.timeout(10000),
      });
    } catch { await connection.query('ROLLBACK'); throw new Error('暂时无法续期 GitHub 授权'); }
    if (!response.ok) { await connection.query('ROLLBACK'); throw new Error('暂时无法续期 GitHub 授权'); }
    const data = await response.json();
    if (data.error === 'bad_refresh_token' || data.error === 'invalid_grant') {
      await connection.query('DELETE FROM project_github_connections WHERE owner_id=$1', [ownerId]);
      await connection.query('COMMIT');
      throw new GithubAuthorizationError('GitHub 授权已失效，请重新连接');
    }
    if (data.error || typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0 || !Number.isFinite(Number(data.refresh_token_expires_in)) || Number(data.refresh_token_expires_in) <= 0) {
      await connection.query('ROLLBACK');
      throw new Error('GitHub 续期响应无效');
    }
    const version = keyVersion();
    const access = seal(data.access_token, ownerId, 'access', version);
    const refresh = seal(data.refresh_token, ownerId, 'refresh', version);
    const updated = await connection.query(`UPDATE project_github_connections SET access_cipher=$2,access_nonce=$3,access_tag=$4,
      refresh_cipher=$5,refresh_nonce=$6,refresh_tag=$7,access_expires_at=now()+($8 * interval '1 second'),
      refresh_expires_at=now()+($9 * interval '1 second'),key_version=$10,updated_at=now() WHERE owner_id=$1 RETURNING access_tag`,
    [ownerId,access.data,access.nonce,access.tag,refresh.data,refresh.nonce,refresh.tag,Number(data.expires_in),Number(data.refresh_token_expires_in),version]);
    await connection.query('COMMIT');
    return { token: data.access_token, accessTag: updated.rows[0].access_tag };
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { if (pooled) connection.release(); }
}

export async function githubUserFetch(client, ownerId, url) {
  const target = new URL(url);
  if (target.origin !== 'https://api.github.com' || target.username || target.password || target.hash) throw new Error('GitHub API 地址无效');
  const { token, accessTag } = await getGithubUserToken(client, ownerId);
  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  let response;
  try {
    await connection.query('BEGIN');
    const current = await connection.query('SELECT 1 FROM project_github_connections WHERE owner_id=$1 AND access_tag=$2 FOR SHARE', [ownerId,accessTag]);
    if (!current.rowCount) throw new GithubAuthorizationError('GitHub 授权已变化，请重试');
    const upstream = await fetch(target, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'agent-admin-project-analysis', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(10000),
    });
    const chunks = [];
    let size = 0;
    if (upstream.body) for await (const chunk of upstream.body) {
      size += chunk.byteLength;
      if (size > 32 * 1024 * 1024) throw new Error('GitHub 响应超出读取上限');
      chunks.push(chunk);
    }
    response = new Response(size ? Buffer.concat(chunks) : null, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
    await connection.query('COMMIT');
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { if (pooled) connection.release(); }
  if (response.status === 401) {
    await client.query('DELETE FROM project_github_connections WHERE owner_id=$1 AND access_tag=$2', [ownerId,accessTag]);
    throw new GithubAuthorizationError('GitHub 授权已失效，请重新连接');
  }
  return response;
}

export async function assertGithubPrivateRepoAccess(client, ownerId, fullName) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(fullName || '')) throw new GithubAuthorizationError('仓库名称无效');
  const response = await githubUserFetch(client, ownerId, `https://api.github.com/repos/${fullName}`);
  if ([403,429].includes(response.status) && (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || response.headers.get('retry-after'))) {
    const wait = Number(response.headers.get('retry-after'));
    throw Object.assign(new Error('GitHub 请求受限'), { rateLimited: true, retryAfterMs: Number.isFinite(wait) && wait > 0 ? wait * 1000 : 60_000 });
  }
  if ([403,404].includes(response.status)) throw new GithubAuthorizationError('GitHub App 当前无权访问该私有仓库');
  if (!response.ok) throw new Error('暂时无法核验 GitHub 仓库权限');
  const info = await response.json();
  if (info.private !== true || info.full_name?.toLowerCase() !== fullName.toLowerCase()) throw new GithubAuthorizationError('该仓库已不属于当前私有授权范围');
  return info;
}

async function listGithubRepositories(client, ownerId) {
  const repositories = [];
  let truncated = false;
  const installationsResponse = await githubUserFetch(client, ownerId, 'https://api.github.com/user/installations?per_page=100');
  if (!installationsResponse.ok) throw new Error('无法读取 GitHub App 安装列表');
  const installations = await installationsResponse.json();
  if (!Array.isArray(installations.installations)) throw new Error('GitHub App 安装列表无效');
  if (installations.total_count > 100) truncated = true;
  for (const installation of installations.installations) {
    if (repositories.length >= 500) { truncated = true; break; }
    if (!Number.isSafeInteger(installation.id)) continue;
    for (let page = 1; page <= 5; page++) {
      const response = await githubUserFetch(client, ownerId, `https://api.github.com/user/installations/${installation.id}/repositories?per_page=100&page=${page}`);
      if (!response.ok) throw new Error('无法读取 GitHub App 已选仓库');
      const data = await response.json();
      if (!Array.isArray(data.repositories)) throw new Error('GitHub App 仓库列表无效');
      for (const repo of data.repositories) {
        if (typeof repo.full_name === 'string' && typeof repo.private === 'boolean') repositories.push({ fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch || null });
      }
      if (repositories.length >= 500) { truncated = true; break; }
      if (data.repositories.length < 100) break;
      if (page === 5) truncated = true;
    }
  }
  return { items: repositories, truncated };
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

export async function completeProjectGithubAuthorization(client, params, browserNonce) {
  const state = params.get('state');
  const code = params.get('code');
  if (!state || !/^[a-f\d]{64}$/i.test(state) || !/^[a-f\d]{64}$/i.test(browserNonce || '') || !code || code.length > 500 || !configured()) return false;
  const claim = (await client.query('SELECT owner_id FROM project_github_oauth_states WHERE state_hash=$1 AND browser_nonce_hash=$2 AND expires_at>now()', [hash(state),hash(browserNonce)])).rows[0];
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
    const consumed = await connection.query('DELETE FROM project_github_oauth_states WHERE state_hash=$1 AND browser_nonce_hash=$2 AND owner_id=$3 AND expires_at>now() RETURNING owner_id', [hash(state),hash(browserNonce),claim.owner_id]);
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
  if (pathname === '/api/project-github/repositories' && method === 'GET') {
    try { return { status: 200, data: await listGithubRepositories(client, me.id) }; }
    catch (error) { return fail(error instanceof GithubAuthorizationError ? 409 : 502, error instanceof GithubAuthorizationError ? error.message : 'GitHub 仓库列表暂不可用'); }
  }
  if (pathname === '/api/project-github/start' && method === 'POST') {
    if (!configured()) return fail(503, 'GitHub App 尚未配置');
    let callback;
    try { callback = new URL(process.env.GITHUB_APP_CALLBACK_URL); }
    catch { return fail(503, 'GitHub App 回调地址无效'); }
    if (callback.pathname !== '/api/project-github/callback' || callback.search || callback.hash || callback.username || callback.password || callback.protocol !== 'https:' && !(callback.protocol === 'http:' && ['localhost','127.0.0.1'].includes(callback.hostname))) return fail(503, 'GitHub App 回调地址必须指向安全的授权接口');
    const state = crypto.randomBytes(32).toString('hex');
    const browserNonce = crypto.randomBytes(32).toString('hex');
    await client.query('DELETE FROM project_github_oauth_states WHERE expires_at<=now()');
    await client.query('INSERT INTO project_github_oauth_states(state_hash,browser_nonce_hash,owner_id,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')', [hash(state),hash(browserNonce),me.id]);
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({ client_id: process.env.GITHUB_APP_CLIENT_ID, redirect_uri: callback.toString(), state }).toString();
    if (req) await appendSecurityAudit(client,req,me,'github_authorization.started','project_github_connections',me.id);
    return { status: 200, data: { url: url.toString() }, browserNonce, secureCookie: callback.protocol === 'https:' };
  }
  if (pathname === '/api/project-github' && method === 'DELETE') {
    const pooled = client instanceof pg.Pool;
    const connection = pooled ? await client.connect() : client;
    try {
      await connection.query('BEGIN');
      await connection.query('DELETE FROM project_github_oauth_states WHERE owner_id=$1', [me.id]);
      await connection.query('DELETE FROM project_github_connections WHERE owner_id=$1', [me.id]);
      await connection.query('UPDATE project_repositories SET webhook_scan_enabled=false,updated_at=now() WHERE owner_id=$1 AND is_private=true AND webhook_scan_enabled=true', [me.id]);
      if (req) await appendSecurityAudit(connection,req,me,'github_authorization.disconnected','project_github_connections',me.id);
      await connection.query('COMMIT');
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { if (pooled) connection.release(); }
    return { status: 200, data: { connected: false } };
  }
  return fail(405, '不支持该操作');
}
