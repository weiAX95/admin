const MINUTE = 60_000;

export async function collectAlertMetrics(pool, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(748209)');
    const sampledAt = new Date(Math.floor(now.getTime() / MINUTE) * MINUTE);
    const hourAgo = new Date(sampledAt.getTime() - 60 * MINUTE);
    const fiveMinutesAgo = new Date(sampledAt.getTime() - 5 * MINUTE);
    const dayStart = (await client.query("SELECT (date_trunc('day',$1::timestamptz AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') AS start", [sampledAt])).rows[0].start;
    const samples = [];
    const add = (metric, value, count, scopeType = 'global', scopeId = '*') => {
      if (value !== null && Number.isFinite(Number(value))) samples.push({ metric, value: Number(value), count: Number(count), scopeType, scopeId });
    };

    const sessions = (await client.query(`
      SELECT count(*) FILTER (WHERE prompt_tokens IS NOT NULL)::integer AS usage_count,
        COALESCE(sum(prompt_tokens+completion_tokens),0)::bigint AS tokens
      FROM session_messages WHERE at >= $1 AND at < $2 AND prompt_tokens IS NOT NULL`, [dayStart.toISOString(), sampledAt.toISOString()])).rows[0];
    add('session_daily_tokens', sessions.tokens, sessions.usage_count);
    const refusal = (await client.query(`
      SELECT count(*)::integer AS session_count,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM session_quality_flags f WHERE f.session_id=s.id AND f.flag_type='rejection'
        ))::integer AS rejected_count
      FROM (SELECT id FROM sessions ORDER BY updated_at DESC NULLS LAST LIMIT 5) s`)).rows[0];
    add('session_refusal_streak', refusal.session_count === 5 ? refusal.rejected_count : 0, refusal.session_count);
    const negative = (await client.query(`
      SELECT count(*)::integer AS total,
        count(*) FILTER (WHERE a.rating<=2 OR EXISTS (
          SELECT 1 FROM annotation_tags t WHERE t.annotation_id=a.id AND t.tag IN ('不准确','偏题','幻觉','过于冗长','过于简略','格式错误')
        ))::integer AS negative
      FROM message_annotations a WHERE a.updated_at >= $1 AND a.updated_at < $2`, [hourAgo.toISOString(), sampledAt.toISOString()])).rows[0];
    if (negative.total > 0) add('session_negative_rate', Number(negative.negative) * 100 / Number(negative.total), negative.total);

    const models = (await client.query(`
      SELECT m.id, count(a.request_id)::integer AS total,
        count(a.request_id) FILTER (WHERE a.status_code BETWEEN 500 AND 599)::integer AS errors,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY a.latency_ms) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY a.latency_ms) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY a.latency_ms) AS p99
      FROM experiment_models m LEFT JOIN model_call_audit a ON a.model_id=m.id
        AND a.created_at >= $1 AND a.created_at < $2
      GROUP BY m.id`, [fiveMinutesAgo, sampledAt])).rows;
    for (const model of models) {
      if (!model.total) continue;
      add('model_5xx_rate', Number(model.errors) * 100 / Number(model.total), model.total, 'model', model.id);
      add('model_p50_ms', model.p50, model.total, 'model', model.id);
      add('model_p95_ms', model.p95, model.total, 'model', model.id);
      add('model_p99_ms', model.p99, model.total, 'model', model.id);
      add('model_qps', Number(model.total) / 300, model.total, 'model', model.id);
    }
    const rateRejections = (await client.query(`SELECT m.id,count(r.id)::integer AS rejected
      FROM experiment_models m LEFT JOIN model_rate_rejections r ON r.model_id=m.id
        AND r.created_at >= $1 AND r.created_at < $2
      GROUP BY m.id`, [fiveMinutesAgo,sampledAt])).rows;
    for (const model of rateRejections) add('model_rate_rejections_5m',model.rejected,model.rejected,'model',model.id);

    const evaluation = (await client.query(`
      SELECT count(*) FILTER (WHERE rm.passed IS NOT NULL)::integer AS scored,
        count(*) FILTER (WHERE rm.passed=true)::integer AS passed,
        avg(rm.combined_score) AS average_score
      FROM experiment_run_metrics rm JOIN experiment_runs r ON r.id=rm.run_id
      JOIN experiment_batches b ON b.id=r.batch_id
      WHERE b.kind IN ('dataset','regression') AND r.completed_at >= $1 AND r.completed_at < $2`, [hourAgo, sampledAt])).rows[0];
    if (evaluation.scored > 0) {
      add('evaluation_pass_rate', Number(evaluation.passed) * 100 / Number(evaluation.scored), evaluation.scored);
      add('evaluation_average_score', evaluation.average_score, evaluation.scored);
    }

    const costs = (await client.query(`
      SELECT COALESCE(sum(amount_usd) FILTER (WHERE charged_at >= $1),0) AS daily_cost,
        COALESCE(sum(amount_usd),0) AS monthly_cost,
        count(*) FILTER (WHERE charged_at >= $1)::integer AS daily_count
      FROM model_cost_ledger WHERE charged_at >= date_trunc('month',$2::timestamptz AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
        AND charged_at < $2`, [dayStart, sampledAt])).rows[0];
    add('governance_daily_cost_usd', costs.daily_cost, costs.daily_count);
    const budget = (await client.query('SELECT monthly_budget_usd FROM model_cost_settings WHERE id=1')).rows[0]?.monthly_budget_usd;
    if (Number(budget) > 0) add('governance_budget_used_percent', Number(costs.monthly_cost) * 100 / Number(budget), costs.daily_count);

    for (const sample of samples) await client.query(`
      INSERT INTO alert_metric_samples(metric,scope_type,scope_id,sampled_at,value,source_count)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(metric,scope_type,scope_id,sampled_at)
      DO UPDATE SET value=EXCLUDED.value,source_count=EXCLUDED.source_count`,
    [sample.metric, sample.scopeType, sample.scopeId, sampledAt, sample.value, sample.count]);
    await client.query("DELETE FROM alert_metric_samples WHERE sampled_at < $1::timestamptz - interval '30 days'", [sampledAt]);
    await client.query('COMMIT');
    return { sampledAt: sampledAt.toISOString(), count: samples.length };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function handleAlertMetrics({ pathname, method, client, me, url }) {
  if (pathname !== '/api/alerts/metrics' || method !== 'GET') return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可查看告警指标' } };
  const metric = url.searchParams.get('metric');
  const scopeId = url.searchParams.get('scopeId') || '*';
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 120));
  const rows = (await client.query(`SELECT metric,scope_type,scope_id,sampled_at,value,source_count
    FROM alert_metric_samples WHERE ($1::text IS NULL OR metric=$1) AND ($2='*' OR scope_id=$2)
    ORDER BY sampled_at DESC LIMIT $3`, [metric, scopeId, limit])).rows;
  return { status: 200, data: { items: rows } };
}
