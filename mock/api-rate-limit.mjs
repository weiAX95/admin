import { requestLoginIp } from './login-network.mjs';

// This service currently runs as one local API process. Keep these counters
// bounded; a multi-process deployment must replace them with a shared store.
const LIMITS = {
  ip: { count: 300, windowMs: 60_000 },
  account: { count: 180, windowMs: 60_000 },
  authIp: { count: 10, windowMs: 15 * 60_000 },
};
const MAX_BUCKETS = 20_000;
const buckets = new Map();
const AUTH_WRITES = new Set([
  '/api/auth/login',
  '/api/auth/mfa/verify',
  '/api/auth/register',
  '/api/auth/invitations/preview',
  '/api/auth/mfa/setup',
  '/api/auth/mfa/confirm',
  '/api/auth/mfa/disable',
  '/api/auth/password',
]);

function cleanup(now) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

const cleanupTimer = setInterval(() => cleanup(Date.now()), 60_000);
cleanupTimer.unref();

function denied(limit, retryAfterSeconds) {
  return {
    error: '请求过于频繁，请稍后重试',
    code: 'API_RATE_LIMIT',
    retryAfterSeconds,
    limit: limit.count,
    windowSeconds: limit.windowMs / 1000,
  };
}

function consume(key, limit, now) {
  let bucket = buckets.get(key);
  if (bucket && bucket.resetAt <= now) {
    buckets.delete(key);
    bucket = null;
  }
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) cleanup(now);
    if (buckets.size >= MAX_BUCKETS) return denied(limit, 60);
    buckets.set(key, { used: 1, resetAt: now + limit.windowMs });
    return null;
  }
  if (bucket.used >= limit.count) return denied(limit, Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
  bucket.used += 1;
  return null;
}

export function checkApiIpRateLimit(req, pathname, method = req.method || 'GET', now = Date.now()) {
  if (method === 'OPTIONS' || !(pathname === '/api' || pathname.startsWith('/api/'))) return null;
  // requestLoginIp trusts X-Forwarded-For only when the socket peer is an
  // explicitly configured reverse proxy; a direct caller cannot spoof a key.
  const ip = requestLoginIp(req);
  const general = consume(`ip:${ip}`, LIMITS.ip, now);
  if (general) return general;
  if (method !== 'GET' && AUTH_WRITES.has(pathname)) return consume(`auth:${ip}`, LIMITS.authIp, now);
  return null;
}

export function checkApiAccountRateLimit(accountId, now = Date.now()) {
  if (!accountId) return null;
  return consume(`account:${accountId}`, LIMITS.account, now);
}
