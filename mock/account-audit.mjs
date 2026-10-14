import { requestLoginIp } from './login-network.mjs';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const namedActions = new Set(['restore', 'permanent', 'activate', 'revoke', 'retry', 'cancel', 'pause', 'resume', 'archive']);

export async function recordAccountAction(client, req, res) {
  const actor = res.__actor;
  const response = res.__pending;
  if (!actor || !response || response.status < 200 || response.status >= 300 || !WRITE_METHODS.has(req.method)) return;
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/api/')) return;
  if (pathname === '/api/account-activity/page-view') return;
  const parts = pathname.slice(5).split('/').filter(Boolean);
  const action = pathname === '/api/auth/logout' ? 'logout' : pathname === '/api/auth/password' ? 'password_change'
    : parts.at(-1) && namedActions.has(parts.at(-1)) ? parts.at(-1)
    : req.method === 'POST' ? 'create' : req.method === 'DELETE' ? 'delete' : 'update';
  const resource = parts[0] === 'auth' ? 'account' : parts[0] || 'unknown';
  const targetId = parts[0] === 'auth' ? actor.id
    : response.payload?.id || (parts[1] === 'invitations' ? parts[2] : parts[1]) || null;
  const details = {
    path: pathname, method: req.method, actorUsername: actor.username,
    ipAddress: requestLoginIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
  };
  if (parts[0] === 'users' && res.__accountBefore) {
    const before = res.__accountBefore;
    const after = res.__accountAfter;
    if (after && before.role !== after.role) details.roleChange = { from: before.role, to: after.role };
    if (before.status !== after?.status) details.statusChange = { from: before.status, to: after?.status || 'purged' };
  } else if (pathname === '/api/users' && req.method === 'POST') {
    details.roleChange = { from: null, to: response.payload?.role };
    details.statusChange = { from: null, to: response.payload?.status };
  }
  await client.query(`INSERT INTO security_audit_logs(actor_id,action,target_type,target_id,details)
    VALUES($1,$2,$3,$4,$5)`, [actor.id, action, resource, targetId, JSON.stringify(details)]);
}
