const MODULES = new Set(['dashboard', 'tasks', 'sessions', 'notes', 'experiments', 'evaluation', 'prompts', 'project-analysis', 'accounts', 'account-audit', 'settings', 'model-costs', 'model-call-audit', 'model-health', 'alerts']);

function pageModule(pathname) {
  const name = String(pathname || '').split('?')[0].split('/').filter(Boolean)[0] || 'dashboard';
  return MODULES.has(name) ? name : 'other';
}

export async function handleAccountActivity({ pathname, method, client, me, readBody }) {
  if (pathname === '/api/account-activity/page-view') {
    if (method !== 'POST') return { status: 405, data: { error: 'method not allowed' } };
    const body = await readBody();
    if (typeof body.path !== 'string' || !body.path.startsWith('/') || body.path.length > 200) return { status: 400, data: { error: '页面路径无效' } };
    const module = pageModule(body.path);
    const timezone = (await client.query('SELECT default_timezone FROM system_settings WHERE id=1')).rows[0].default_timezone;
    await client.query(`INSERT INTO account_page_views(user_id,local_date,module,view_count)
      VALUES($1,(now() AT TIME ZONE $2)::date,$3,1)
      ON CONFLICT(user_id,local_date,module) DO UPDATE SET view_count=account_page_views.view_count+1,last_view_at=now()`, [me.id,timezone,module]);
    return { status: 200, data: { recorded: true } };
  }
  if (pathname !== '/api/account-activity') return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可查看团队活跃度' } };
  if (method !== 'GET') return { status: 405, data: { error: 'method not allowed' } };
  const timezone = (await client.query('SELECT default_timezone FROM system_settings WHERE id=1')).rows[0].default_timezone;
  const login = (await client.query(`SELECT user_id,COUNT(DISTINCT (created_at AT TIME ZONE $1)::date)::integer AS days
    FROM account_login_history WHERE succeeded=true AND user_id IS NOT NULL
      AND (created_at AT TIME ZONE $1)::date >= (now() AT TIME ZONE $1)::date - 29
    GROUP BY user_id`, [timezone])).rows;
  const operations = (await client.query(`SELECT actor_id,COUNT(*)::integer AS count FROM security_audit_logs
    WHERE actor_id IS NOT NULL AND action NOT IN ('login_success','login_failure','logout')
      AND (created_at AT TIME ZONE $1)::date >= (now() AT TIME ZONE $1)::date - 29
    GROUP BY actor_id`, [timezone])).rows;
  const lastOperations = (await client.query(`SELECT actor_id,MAX(created_at) AS last_at FROM security_audit_logs
    WHERE actor_id IS NOT NULL GROUP BY actor_id`)).rows;
  const visits = (await client.query(`SELECT user_id,module,SUM(view_count)::integer AS count FROM account_page_views
    WHERE local_date >= (now() AT TIME ZONE $1)::date - 29 GROUP BY user_id,module`, [timezone])).rows;
  const loginDays = new Map(login.map(row => [row.user_id, row.days]));
  const operationCounts = new Map(operations.map(row => [row.actor_id, row.count]));
  const operationLastAt = new Map(lastOperations.map(row => [row.actor_id, row.last_at]));
  const modules = new Map();
  for (const row of visits) {
    const current = modules.get(row.user_id) || { views: 0, top: null, topCount: 0 };
    current.views += row.count;
    if (row.count > current.topCount || row.count === current.topCount && (!current.top || row.module < current.top)) {
      current.top = row.module; current.topCount = row.count;
    }
    modules.set(row.user_id, current);
  }
  const users = (await client.query(`SELECT id,username,name,role,status,created_at,last_login_at,inactive_since
    FROM users WHERE deleted_at IS NULL`)).rows;
  const lastViews = new Map((await client.query('SELECT user_id,MAX(last_view_at) AS last_at FROM account_page_views GROUP BY user_id')).rows.map(row => [row.user_id, row.last_at]));
  const items = users.map(user => {
    const visits = modules.get(user.id);
    const days = loginDays.get(user.id) || 0;
    const operations = operationCounts.get(user.id) || 0;
    const views = visits?.views || 0;
    const lastActiveAt = [user.last_login_at, operationLastAt.get(user.id), lastViews.get(user.id)]
      .filter(Boolean).sort((a,b) => new Date(b).getTime()-new Date(a).getTime())[0] || null;
    return { id: user.id, username: user.username, name: user.name, role: user.role,
      status: user.status, lastLoginAt: user.last_login_at, lastActiveAt, inactiveSince: user.inactive_since,
      loginDays: days, operationCount: operations, pageViews: views, mostVisitedModule: visits?.top || null,
      activityScore: views + operations + days * 2 };
  }).sort((a,b) => b.activityScore-a.activityScore || a.username.localeCompare(b.username))
    .map((item,index) => ({ ...item, rank: index+1 }));
  return { status: 200, data: { items, windowDays: 30, timezone } };
}

export async function markInactiveAccounts(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(748201)');
    const result = await client.query(`UPDATE users SET inactive_since=COALESCE(inactive_since,now())
      WHERE deleted_at IS NULL AND status='active' AND inactive_since IS NULL
        AND COALESCE(last_login_at, activity_tracking_started_at) <= now()-interval '30 days'`);
    await client.query('COMMIT');
    return result.rowCount;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
