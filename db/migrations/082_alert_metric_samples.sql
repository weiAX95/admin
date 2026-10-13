CREATE TABLE alert_metric_samples (
  metric text NOT NULL CHECK(metric IN (
    'session_daily_tokens','session_refusal_streak','session_negative_rate',
    'model_5xx_rate','model_p50_ms','model_p95_ms','model_p99_ms','model_qps',
    'evaluation_pass_rate','evaluation_average_score',
    'governance_daily_cost_usd','governance_budget_used_percent'
  )),
  scope_type text NOT NULL CHECK(scope_type IN ('global','model')),
  scope_id text NOT NULL,
  sampled_at timestamptz NOT NULL,
  value numeric(20,6) NOT NULL,
  source_count integer NOT NULL DEFAULT 0 CHECK(source_count >= 0),
  PRIMARY KEY(metric,scope_type,scope_id,sampled_at),
  CHECK((scope_type='global' AND scope_id='*') OR (scope_type='model' AND scope_id<>'*'))
);
CREATE INDEX alert_metric_samples_time_idx ON alert_metric_samples(sampled_at DESC);
CREATE INDEX sessions_alert_recent_idx ON sessions(updated_at DESC);
CREATE INDEX message_annotations_alert_recent_idx ON message_annotations(updated_at DESC);
CREATE INDEX experiment_runs_alert_completed_idx ON experiment_runs(completed_at) WHERE completed_at IS NOT NULL;
