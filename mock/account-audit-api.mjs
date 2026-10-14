import { isAdministrator } from './roles.mjs';
export async function handleAccountAudit({ pathname, method, url, client, me }) {
  if (pathname !== '/api/account-audit') return null;
  if (method !== 'GET') return { status: 405, data: { error: 'method not allowed' } };
  const page = Number(url.searchParams.get('page') || 1);
  const pageSize = Number(url.searchParams.get('pageSize') || 50);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    return { status: 400, data: { error: '分页参数无效' } };
  }
  const clauses = [], values = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  const actorId = isAdministrator(me) ? url.searchParams.get('actorId') : me.id;
  if (actorId) clauses.push(`actor_id=${bind(actorId)}`);
  const action = url.searchParams.get('action');
  if (action) clauses.push(`action=${bind(action)}`);
  const resource = url.searchParams.get('resource');
  if (resource) clauses.push(`target_type=${bind(resource)}`);
  for (const key of ['from', 'to']) {
    const date = url.searchParams.get(key);
    if (!date) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      return { status: 400, data: { error: '日期格式须为 YYYY-MM-DD' } };
    }
    const parameter = bind(`${date}T00:00:00+08:00`);
    clauses.push(key === 'from' ? `created_at>=${parameter}::timestamptz`
      : `created_at<(${parameter}::timestamptz + interval '1 day')`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (await client.query(`SELECT count(*)::integer AS count FROM security_audit_logs ${where}`, values)).rows[0].count;
  const rows = (await client.query(`SELECT id,actor_id,action,target_type,target_id,details,created_at
    FROM security_audit_logs ${where} ORDER BY created_at DESC,id DESC
    LIMIT ${bind(pageSize)} OFFSET ${bind((page - 1) * pageSize)}`, values)).rows;
  return { status: 200, data: { total, page, pageSize, items: rows.map(row => ({
    id: row.id, actorId: row.actor_id, action: row.action, resource: row.target_type,
    resourceId: row.target_id, details: row.details, createdAt: row.created_at,
  })) } };
}
