import { notifyUser } from './app-notifications.mjs';

/** Shanghai calendar reminders at 7, 3 and 1 days before the 90-day deadline. */
export async function createPasswordExpiryReminders(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = (await client.query(`WITH latest AS (
      SELECT DISTINCT ON (user_id) user_id, changed_at
      FROM password_history ORDER BY user_id, changed_at DESC, id DESC
    ), due AS (
      SELECT u.id, ((h.changed_at AT TIME ZONE 'Asia/Shanghai')::date + 90) AS due_on,
        ((h.changed_at AT TIME ZONE 'Asia/Shanghai')::date + 90 - (now() AT TIME ZONE 'Asia/Shanghai')::date) AS days_left
      FROM users u JOIN latest h ON h.user_id=u.id WHERE u.status='active'
    ) SELECT id,to_char(due_on,'YYYY-MM-DD') AS due_on,days_left FROM due WHERE days_left IN (7,3,1)`)).rows;
    let created = 0;
    for (const row of rows) {
      if (await notifyUser(client, row.id, 'password_expiry', `${row.id}:${row.due_on}:${row.days_left}`, '密码即将过期', `密码将在 ${row.days_left} 天后到期（${row.due_on}），请在个人设置中修改。`, '/settings')) created++;
    }
    await client.query('COMMIT');
    return created;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
