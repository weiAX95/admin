import { notifyUser } from './app-notifications.mjs';

export async function getModelHealthReport(client) {
  const rows = (await client.query(`SELECT m.id,m.display_name,m.status,
      count(a.request_id)::integer AS sample_count,
      round((count(a.request_id)::numeric / 300),3) AS qps,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY a.latency_ms)::numeric,0) AS p50_ms,
      round(percentile_cont(0.95) WITHIN GROUP (ORDER BY a.latency_ms)::numeric,0) AS p95_ms,
      round(percentile_cont(0.99) WITHIN GROUP (ORDER BY a.latency_ms)::numeric,0) AS p99_ms,
      round((count(a.request_id) FILTER (WHERE a.status_code BETWEEN 500 AND 599) * 100.0 / nullif(count(a.request_id),0))::numeric,2) AS error_rate_5xx,
      max(a.created_at) AS last_call_at
    FROM experiment_models m LEFT JOIN model_call_audit a ON a.model_id=m.id AND a.created_at >= now()-interval '5 minutes'
    GROUP BY m.id,m.display_name,m.status ORDER BY m.display_name,m.id`)).rows;
  const items = rows.map(row => {
    const sampleCount = Number(row.sample_count);
    const p95Ms = row.p95_ms === null ? null : Number(row.p95_ms);
    const errorRate5xx = row.error_rate_5xx === null ? null : Number(row.error_rate_5xx);
    return { id: row.id, displayName: row.display_name, status: row.status, sampleCount,
      qps: Number(row.qps), p50Ms: row.p50_ms === null ? null : Number(row.p50_ms), p95Ms,
      p99Ms: row.p99_ms === null ? null : Number(row.p99_ms), errorRate5xx,
      lastCallAt: row.last_call_at,
      health: row.status === 'retired' ? 'retired' : !sampleCount ? 'unknown' : errorRate5xx > 5 || p95Ms > 10000 ? 'degraded' : 'healthy' };
  });
  return { windowSeconds: 300, measuredAt: new Date().toISOString(), items };
}

export async function handleModelHealth({ pathname, method, client, me }) {
  if (pathname !== '/api/model-health' || method !== 'GET') return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可查看模型健康状态' } };
  return { status: 200, data: await getModelHealthReport(client) };
}

export async function processModelHealthAlerts(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const report = await getModelHealthReport(client);
    for (const model of report.items) {
      const degraded = model.health === 'degraded';
      const changed = (await client.query(`INSERT INTO model_health_alert_state(model_id,degraded,generation,updated_at)
        VALUES($1,$2,CASE WHEN $2 THEN 1 ELSE 0 END,now())
        ON CONFLICT(model_id) DO UPDATE SET degraded=EXCLUDED.degraded,generation=model_health_alert_state.generation+1,updated_at=now()
        WHERE model_health_alert_state.degraded IS DISTINCT FROM EXCLUDED.degraded RETURNING generation`, [model.id,degraded])).rows[0];
      if (!degraded || !changed) continue;
      const admins = (await client.query("SELECT id FROM users WHERE role='admin' AND status='active'")).rows;
      for (const admin of admins) await notifyUser(client,admin.id,'model-health',`${model.id}:${changed.generation}`,'模型健康异常',`${model.displayName}：近 5 分钟 5xx 错误率 ${model.errorRate5xx}% ，P95 ${model.p95Ms} ms。`,'/model-health');
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
