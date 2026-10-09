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
