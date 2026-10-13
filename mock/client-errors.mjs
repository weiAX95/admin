import { randomUUID } from 'node:crypto';

const safeName = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value);

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (!safeName(body.errorName) || !Array.isArray(body.components) || body.components.length > 12 || !body.components.every(safeName)) return null;
  if (typeof body.path !== 'string' || !body.path.startsWith('/') || body.path.length > 256 || /[?#\x00-\x1f]/.test(body.path)) return null;
  return {
    errorName: body.errorName,
    components: body.components,
    path: body.path.replace(/^\/share\/(experiments|evaluation-reports)\/[^/]+/, '/share/$1/:token'),
  };
}

export async function saveClientError(pool, me, body) {
  const report = validate(body);
  if (!report) return { status: 400, data: { error: '错误报告格式无效' } };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`client-error:${me.id}`]);
    const recent = (await client.query("SELECT count(*)::int AS count FROM client_error_reports WHERE user_id=$1 AND created_at>now()-interval '1 minute'", [me.id])).rows[0].count;
    if (recent >= 20) {
      await client.query('COMMIT');
      return { status: 429, data: { error: '错误报告过于频繁', retryAfterSeconds: 60 } };
    }
    const id = randomUUID();
    await client.query('INSERT INTO client_error_reports(id,user_id,path,error_name,components) VALUES($1,$2,$3,$4,$5)', [id, me.id, report.path, report.errorName, report.components]);
    await client.query('COMMIT');
    return { status: 201, data: { id } };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
