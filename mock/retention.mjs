const view = row => ({ version: row.version, auditDays: row.audit_days, sessionDays: row.session_days, recycleDays: row.recycle_days, cleanupLocalTime: String(row.cleanup_local_time).slice(0,5) });
function valid(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isInteger(body.version)) throw new Error('缺少有效版本号');
  if (!Number.isInteger(body.auditDays) || body.auditDays < 30 || body.auditDays > 365) throw new Error('审计日志保留范围为 30–365 天');
  if (!Number.isInteger(body.sessionDays) || body.sessionDays < 7 || body.sessionDays > 730) throw new Error('会话保留范围为 7–730 天');
  if (!Number.isInteger(body.recycleDays) || body.recycleDays !== 0 && (body.recycleDays < 7 || body.recycleDays > 90)) throw new Error('回收站保留范围为 7–90 天，0 表示立即删除');
  if (typeof body.cleanupLocalTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.cleanupLocalTime)) throw new Error('清理时间格式须为 HH:mm');
}
export async function handleRetentionSettings({ pathname, method, client, me, readBody }) {
  if (pathname === '/api/settings/retention') {
    if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可管理保留策略' } };
    if (method === 'GET') return { status: 200, data: view((await client.query('SELECT * FROM retention_settings WHERE id=1')).rows[0]) };
    if (method === 'PUT') {
      const body = await readBody(); valid(body);
      const result = await client.query('UPDATE retention_settings SET audit_days=$1,session_days=$2,recycle_days=$3,cleanup_local_time=$4,version=version+1,updated_at=now() WHERE id=1 AND version=$5 RETURNING *', [body.auditDays,body.sessionDays,body.recycleDays,body.cleanupLocalTime,body.version]);
      return result.rowCount ? { status: 200, data: view(result.rows[0]) } : { status: 409, data: { error: '保留策略版本已过期' } };
    }
  }
  if (pathname === '/api/settings/retention/runs' && method === 'GET') {
    if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可查看清理记录' } };
    return { status: 200, data: { items: (await client.query('SELECT * FROM retention_cleanup_runs ORDER BY local_date DESC LIMIT 30')).rows } };
  }
  return null;
}

function localClock(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export async function runRetentionCleanup(pool, now = new Date(), force = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(748201)');
    const settings = (await client.query('SELECT * FROM retention_settings WHERE id=1')).rows[0];
    const timezone = (await client.query('SELECT default_timezone FROM system_settings WHERE id=1')).rows[0].default_timezone;
    const clock = localClock(now, timezone);
    if (!force && clock.time < String(settings.cleanup_local_time).slice(0,5)) { await client.query('COMMIT'); return null; }
    const existing = await client.query('SELECT 1 FROM retention_cleanup_runs WHERE local_date=$1', [clock.date]);
    if (existing.rowCount) { await client.query('COMMIT'); return null; }
    await client.query('INSERT INTO retention_cleanup_runs(local_date) VALUES($1)', [clock.date]);
    const audit = await client.query('DELETE FROM security_audit_logs WHERE created_at < $1::timestamptz - ($2 * interval \'1 day\')', [now.toISOString(), settings.audit_days]);
    const modelAudit = await client.query('DELETE FROM model_call_audit WHERE created_at < $1::timestamptz - ($2 * interval \'1 day\')', [now.toISOString(), settings.audit_days]);
    const modelSecurity = await client.query('DELETE FROM model_security_events WHERE created_at < $1::timestamptz - ($2 * interval \'1 day\')', [now.toISOString(), settings.audit_days]);
    const oldSessions = (await client.query('SELECT id FROM sessions WHERE created_at::timestamptz < $1::timestamptz - ($2 * interval \'1 day\')', [now.toISOString(), settings.session_days])).rows.map(row => row.id);
    let candidates = 0, sessions = 0;
    if (oldSessions.length) {
      candidates = (await client.query("DELETE FROM evaluation_candidates WHERE source_type='session' AND status='pending' AND source_entity_id=ANY($1)", [oldSessions])).rowCount;
      sessions = (await client.query('DELETE FROM sessions WHERE id=ANY($1)', [oldSessions])).rowCount;
    }
    const purged = { tasks: 0, notes: 0, experiments: 0, prompt_library: 0 };
    const failures = [];
    for (const table of Object.keys(purged)) {
      const expired = (await client.query(`SELECT id FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at <= $1::timestamptz - ($2 * interval '1 day') ORDER BY deleted_at`, [now.toISOString(), settings.recycle_days])).rows;
      for (const row of expired) {
        await client.query('SAVEPOINT retention_purge');
        try {
          await client.query(`DELETE FROM ${table} WHERE id=$1`, [row.id]);
          await client.query('RELEASE SAVEPOINT retention_purge');
          purged[table]++;
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT retention_purge');
          await client.query('RELEASE SAVEPOINT retention_purge');
          failures.push({ type: table, id: row.id, reason: '关联记录阻止永久删除' });
        }
      }
    }
    await client.query('UPDATE retention_cleanup_runs SET completed_at=now(),audit_deleted=$2,sessions_deleted=$3,candidates_deleted=$4,tasks_deleted=$5,notes_deleted=$6,experiments_deleted=$7,prompts_deleted=$8,purge_failures=$9 WHERE local_date=$1', [clock.date,audit.rowCount+modelAudit.rowCount+modelSecurity.rowCount,sessions,candidates,purged.tasks,purged.notes,purged.experiments,purged.prompt_library,JSON.stringify(failures)]);
    await client.query('COMMIT');
    return { localDate: clock.date, auditDeleted: audit.rowCount+modelAudit.rowCount+modelSecurity.rowCount, sessionsDeleted: sessions, candidatesDeleted: candidates, purged, failures };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
