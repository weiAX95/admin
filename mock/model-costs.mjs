import { notifyUser } from './app-notifications.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIMENSIONS = new Set(['model', 'user', 'module']);

export async function handleModelCosts({ pathname, method, client, me, url }) {
  if (pathname !== '/api/model-costs' || method !== 'GET') return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可查看成本报表' } };
  const end = url.searchParams.get('end') || new Date().toISOString().slice(0, 10);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  const start = url.searchParams.get('start') || (Number.isNaN(endTime) ? '' : new Date(endTime - 29 * 86400000).toISOString().slice(0, 10));
  const dimension = url.searchParams.get('dimension') || 'model';
  const modelId = url.searchParams.get('modelId') || '';
  const userId = url.searchParams.get('userId') || '';
  const module = url.searchParams.get('module') || '';
  const validDate = value => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(start) || !validDate(end) || start > end || Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) > 366 * 86400000 || !DIMENSIONS.has(dimension) || (module && !['experiments', 'evaluations'].includes(module))) {
    return { status: 400, data: { error: '日期范围或统计维度无效（最多 367 天）' } };
  }
  // Cost is already saved with the run's price snapshot. It includes Judge cost,
  // so subtract that amount from the primary model before attribution.
  const sql = `WITH charged AS (
    SELECT r.model_id, b.owner_id AS user_id,
      CASE WHEN b.kind IN ('dataset','regression') THEN 'evaluations' ELSE 'experiments' END AS module,
      (COALESCE(r.completed_at,r.created_at) AT TIME ZONE 'UTC')::date AS charged_on,
      GREATEST(r.cost_usd - COALESCE(r.judge_cost_usd,0),0)::numeric AS amount
    FROM experiment_runs r JOIN experiment_batches b ON b.id=r.batch_id
    WHERE r.cost_usd IS NOT NULL
    UNION ALL
    SELECT COALESCE(r.judge_model_id,r.model_id), b.owner_id,
      CASE WHEN b.kind IN ('dataset','regression') THEN 'evaluations' ELSE 'experiments' END,
      (COALESCE(r.completed_at,r.created_at) AT TIME ZONE 'UTC')::date,
      r.judge_cost_usd
    FROM experiment_runs r JOIN experiment_batches b ON b.id=r.batch_id
    WHERE r.judge_cost_usd IS NOT NULL AND r.judge_cost_usd > 0
  )
  SELECT c.model_id,c.user_id,c.module,c.charged_on::text AS day,
    COALESCE(m.display_name,c.model_id) AS model_name,
    COALESCE(u.name,u.username,c.user_id,'已删除账号') AS user_name,
    SUM(c.amount)::text AS cost_usd
  FROM charged c LEFT JOIN experiment_models m ON m.id=c.model_id LEFT JOIN users u ON u.id=c.user_id
  WHERE c.charged_on BETWEEN $1::date AND $2::date
    AND ($3::text='' OR c.model_id=$3)
    AND ($4::text='' OR c.user_id=$4)
    AND ($5::text='' OR c.module=$5)
  GROUP BY c.model_id,c.user_id,c.module,c.charged_on,m.display_name,u.name,u.username
  ORDER BY c.charged_on,c.model_id,c.user_id,c.module`;
  const rows = (await client.query(sql, [start, end, modelId, userId, module])).rows;
  const [modelCatalog, userCatalog] = await Promise.all([
    client.query('SELECT id,display_name AS name FROM experiment_models ORDER BY display_name'),
    client.query('SELECT id,COALESCE(name,username) AS name FROM users ORDER BY username'),
  ]);
  const costs = rows.map(row => ({ ...row, costUsd: row.cost_usd }));
  const sum = values => values.reduce((total, value) => total + Number(value), 0);
  const grouped = new Map();
  const trend = new Map();
  for (const row of costs) {
    const key = dimension === 'model' ? row.model_id : dimension === 'user' ? row.user_id || '__deleted__' : row.module;
    const name = dimension === 'model' ? row.model_name : dimension === 'user' ? row.user_name : row.module;
    const item = grouped.get(key) || { key, name, costUsd: 0, runParts: 0 };
    item.costUsd += Number(row.costUsd);
    item.runParts++;
    grouped.set(key, item);
    trend.set(row.day, (trend.get(row.day) || 0) + Number(row.costUsd));
  }
  return { status: 200, data: {
    start, end, dimension, timezone: 'UTC',
    totalUsd: sum(costs.map(row => row.costUsd)).toFixed(6),
    breakdown: [...grouped.values()].sort((a, b) => b.costUsd - a.costUsd).map(item => ({ ...item, costUsd: item.costUsd.toFixed(6) })),
    trend: [...trend].map(([day, costUsd]) => ({ day, costUsd: costUsd.toFixed(6) })).sort((a, b) => a.day.localeCompare(b.day)),
    filters: {
      models: modelCatalog.rows,
      users: userCatalog.rows,
    },
  } };
}

const chargedAt = 'COALESCE(completed_at,created_at)';
export async function monthlyCostStatus(client) {
  const settings = (await client.query('SELECT monthly_budget_usd,version FROM model_cost_settings WHERE id=1')).rows[0];
  const result = (await client.query(`SELECT COALESCE(SUM(cost_usd),0)::text AS total FROM experiment_runs WHERE cost_usd IS NOT NULL AND ${chargedAt} >= date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND ${chargedAt} < (date_trunc('month',now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'`)).rows[0];
  const budget = Number(settings.monthly_budget_usd);
  const spent = Number(result.total);
  return { monthlyBudgetUsd: String(settings.monthly_budget_usd), spentUsd: result.total, percentage: budget > 0 ? spent / budget * 100 : null, version: settings.version, month: new Date().toISOString().slice(0, 7) };
}

export async function handleModelCostBudget({ pathname, method, client, me, readBody }) {
  if (pathname !== '/api/model-cost-budget') return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可管理模型月预算' } };
  if (method === 'GET') return { status: 200, data: await monthlyCostStatus(client) };
  if (method !== 'PUT') return null;
  const body = await readBody();
  const amount = Number(body?.monthlyBudgetUsd);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000 || !/^\d+(\.\d{1,6})?$/.test(String(body?.monthlyBudgetUsd)) || !Number.isSafeInteger(body?.version)) return { status: 400, data: { error: '月预算须为非负金额，最多六位小数，并提供当前版本' } };
  const changed = await client.query('UPDATE model_cost_settings SET monthly_budget_usd=$1,version=version+1,updated_at=now() WHERE id=1 AND version=$2 RETURNING id', [String(body.monthlyBudgetUsd), body.version]);
  if (!changed.rowCount) return { status: 409, data: { error: '预算已由其他管理员修改，请刷新后重试' } };
  return { status: 200, data: await monthlyCostStatus(client) };
}

export async function notifyModelCostAlerts(client) {
  const budget = await monthlyCostStatus(client);
  const admins = (await client.query("SELECT id FROM users WHERE role='admin' AND status='active'")).rows;
  if (budget.percentage !== null) for (const threshold of [80, 100, 120]) if (budget.percentage >= threshold) {
    for (const admin of admins) await notifyUser(client, admin.id, 'model_cost_budget', `${budget.month}:${threshold}`, `模型月预算达到 ${threshold}%`, `本月已记账 $${Number(budget.spentUsd).toFixed(6)}，预算 $${Number(budget.monthlyBudgetUsd).toFixed(6)}。`, '/model-costs');
  }
  const daily = (await client.query(`SELECT
    COALESCE(SUM(cost_usd) FILTER (WHERE (${chargedAt} AT TIME ZONE 'UTC')::date=(now() AT TIME ZONE 'UTC')::date),0)::numeric AS today,
    COALESCE(SUM(cost_usd) FILTER (WHERE (${chargedAt} AT TIME ZONE 'UTC')::date BETWEEN (now() AT TIME ZONE 'UTC')::date-7 AND (now() AT TIME ZONE 'UTC')::date-1),0)::numeric / 7 AS prior_average
    FROM experiment_runs WHERE cost_usd IS NOT NULL AND ${chargedAt} >= now()-interval '9 days'`)).rows[0];
  const today = Number(daily.today), average = Number(daily.prior_average);
  if (average > 0 && today > average * 3) for (const admin of admins) await notifyUser(client, admin.id, 'model_cost_anomaly', new Date().toISOString().slice(0, 10), '模型日成本异常增长', `今日已记账 $${today.toFixed(6)}，超过前七日均值 $${average.toFixed(6)} 的三倍。`, '/model-costs');
}
