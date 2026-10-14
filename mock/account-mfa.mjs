import crypto from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const codePattern = /^\d{6}$/;
const recoveryPattern = /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/;
export const mfaConfigured = () => /^[a-f\d]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY || '');

function key() {
  const value = process.env.MFA_ENCRYPTION_KEY;
  if (!mfaConfigured()) throw new Error('MFA_ENCRYPTION_KEY must be 32 random bytes in hexadecimal');
  return Buffer.from(value, 'hex');
}

function base32(buffer) {
  let bits = 0, number = 0, result = '';
  for (const byte of buffer) {
    number = (number << 8) | byte;
    bits += 8;
    while (bits >= 5) { result += alphabet[(number >>> (bits -= 5)) & 31]; }
  }
  return bits ? result + alphabet[(number << (5 - bits)) & 31] : result;
}

function decodeBase32(text) {
  let bits = 0, number = 0;
  const output = [];
  for (const letter of text) {
    const index = alphabet.indexOf(letter);
    if (index < 0) throw new Error('Invalid TOTP secret');
    number = (number << 5) | index;
    bits += 5;
    if (bits >= 8) { output.push((number >>> (bits -= 8)) & 255); }
  }
  return Buffer.from(output);
}

export function createTotpSecret() { return base32(crypto.randomBytes(20)); }

export function encryptMfaSecret(secret) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

export function decryptMfaSecret(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid MFA secret envelope');
  const [nonce, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64url'));
  if (nonce.length !== 12 || tag.length !== 16) throw new Error('Invalid MFA secret envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function totpAt(secret, counter) {
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(input).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function matchingTotpCounter(secret, code, lastCounter = null, now = Date.now()) {
  if (typeof code !== 'string' || !codePattern.test(code)) return null;
  const current = Math.floor(now / 30_000);
  for (const counter of [current - 1, current, current + 1]) {
    if (lastCounter !== null && counter <= Number(lastCounter)) continue;
    const expected = Buffer.from(totpAt(secret, counter));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) return counter;
  }
  return null;
}

export function recoveryCodeHash(userId, code) {
  if (typeof code !== 'string' || !recoveryPattern.test(code.toUpperCase())) return null;
  return crypto.createHmac('sha256', key()).update(`${userId}:${code.toUpperCase()}`).digest('hex');
}

export function createRecoveryCodes() {
  return Array.from({ length: 8 }, () => crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-'));
}

export function totpUri(secret, username, issuer = 'Agent Admin') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export async function mfaState(client, userId) {
  return (await client.query('SELECT secret_encrypted,pending_secret_encrypted,enabled_at,last_counter FROM account_mfa WHERE user_id=$1', [userId])).rows[0] || null;
}

export async function issueMfaChallenge(client, userId, deviceHash) {
  const token = crypto.randomBytes(32).toString('hex');
  await client.query('DELETE FROM account_mfa_login_challenges WHERE expires_at<=now() OR user_id=$1', [userId]);
  await client.query(`INSERT INTO account_mfa_login_challenges(token_hash,user_id,device_hash,expires_at)
    VALUES($1,$2,$3,now()+interval '5 minutes')`, [crypto.createHash('sha256').update(token).digest('hex'), userId, deviceHash]);
  return token;
}

export async function getMfaChallenge(client, token) {
  if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token)) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return (await client.query(`SELECT token_hash,user_id,device_hash,attempts FROM account_mfa_login_challenges
    WHERE token_hash=$1 AND expires_at>now() FOR UPDATE`, [hash])).rows[0] || null;
}

export async function consumeMfaFactor(client, userId, code) {
  const state = (await client.query('SELECT secret_encrypted,last_counter FROM account_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL FOR UPDATE', [userId])).rows[0];
  if (!state) return false;
  const counter = matchingTotpCounter(decryptMfaSecret(state.secret_encrypted), code, state.last_counter);
  if (counter !== null) {
    await client.query('UPDATE account_mfa SET last_counter=$2,updated_at=now() WHERE user_id=$1', [userId, counter]);
    return true;
  }
  const hash = recoveryCodeHash(userId, code);
  if (!hash) return false;
  return Boolean((await client.query(`UPDATE account_mfa_recovery_codes SET used_at=now()
    WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash`, [userId, hash])).rowCount);
}

export async function handleAccountMfa({ pathname, method, client, me, readBody, tokenHash, verifyPassword }) {
  if (!pathname.startsWith('/api/auth/mfa')) return null;
  const fail = (status, error) => ({ status, data: { error } });
  if (pathname === '/api/auth/mfa' && method === 'GET') {
    const state = await mfaState(client, me.id);
    const remaining = Number((await client.query('SELECT count(*)::int AS n FROM account_mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL', [me.id])).rows[0].n);
    return { status: 200, data: { enabled: Boolean(state?.enabled_at), required: me.role !== 'member', recoveryCodesRemaining: remaining } };
  }
  if (pathname === '/api/auth/mfa/setup' && method === 'POST') {
    if (!mfaConfigured()) return fail(503, '双因素认证密钥尚未配置');
    const body = await readBody();
    if (!verifyPassword(body.currentPassword, me.passwordHash)) return fail(403, '当前密码不正确');
    const state = await mfaState(client, me.id);
    if (state?.enabled_at) return fail(409, '已启用双因素认证');
    const secret = createTotpSecret();
    await client.query(`INSERT INTO account_mfa(user_id,pending_secret_encrypted) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET pending_secret_encrypted=excluded.pending_secret_encrypted,pending_attempts=0,updated_at=now()`, [me.id, encryptMfaSecret(secret)]);
    return { status: 200, data: { secret, uri: totpUri(secret, me.username) } };
  }
  if (pathname === '/api/auth/mfa/confirm' && method === 'POST') {
    if (!mfaConfigured()) return fail(503, '双因素认证密钥尚未配置');
    const body = await readBody();
    const state = (await client.query('SELECT pending_secret_encrypted,pending_attempts,enabled_at FROM account_mfa WHERE user_id=$1 FOR UPDATE', [me.id])).rows[0];
    if (!state?.pending_secret_encrypted || state.enabled_at) return fail(409, '请先获取新的双因素认证密钥');
    const secret = decryptMfaSecret(state.pending_secret_encrypted);
    const counter = matchingTotpCounter(secret, body.code);
    if (counter === null) {
      await client.query(`UPDATE account_mfa SET pending_attempts=pending_attempts+1,
        pending_secret_encrypted=CASE WHEN pending_attempts>=4 THEN NULL ELSE pending_secret_encrypted END,
        updated_at=now() WHERE user_id=$1`, [me.id]);
      return fail(state.pending_attempts >= 4 ? 429 : 400, state.pending_attempts >= 4 ? '尝试过多，请重新开始绑定' : '验证码无效或已过期');
    }
    const codes = createRecoveryCodes();
    await client.query(`UPDATE account_mfa SET secret_encrypted=pending_secret_encrypted,pending_secret_encrypted=NULL,
      enabled_at=now(),pending_attempts=0,last_counter=$2,updated_at=now() WHERE user_id=$1`, [me.id, counter]);
    await client.query('DELETE FROM account_mfa_recovery_codes WHERE user_id=$1', [me.id]);
    for (const code of codes) await client.query('INSERT INTO account_mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)', [me.id, recoveryCodeHash(me.id, code)]);
    await client.query('UPDATE auth_sessions SET mfa_setup_required=false WHERE token_hash=$1 AND user_id=$2', [tokenHash, me.id]);
    return { status: 200, data: { enabled: true, recoveryCodes: codes } };
  }
  if (pathname === '/api/auth/mfa/disable' && method === 'POST') {
    if (!mfaConfigured()) return fail(503, '双因素认证密钥尚未配置');
    if (me.role !== 'member') return fail(403, '管理员必须启用双因素认证');
    const body = await readBody();
    if (!verifyPassword(body.currentPassword, me.passwordHash) || !await consumeMfaFactor(client, me.id, body.code)) return fail(403, '密码或验证码不正确');
    await client.query('DELETE FROM account_mfa_recovery_codes WHERE user_id=$1', [me.id]);
    await client.query('DELETE FROM account_mfa WHERE user_id=$1', [me.id]);
    return { status: 200, data: { enabled: false } };
  }
  return fail(404, '双因素认证接口不存在');
}
