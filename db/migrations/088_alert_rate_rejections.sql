CREATE TABLE model_rate_rejections (
  id text PRIMARY KEY,
  model_id text NOT NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  source_module text NOT NULL CHECK(source_module IN ('experiments','projects')),
  used_requests integer NOT NULL CHECK(used_requests >= 0),
  used_tokens bigint NOT NULL CHECK(used_tokens >= 0),
  requested_requests integer NOT NULL CHECK(requested_requests > 0),
  requested_tokens bigint NOT NULL CHECK(requested_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_rate_rejections_recent_idx ON model_rate_rejections(model_id,created_at DESC);

ALTER TABLE alert_metric_samples DROP CONSTRAINT alert_metric_samples_metric_check;
ALTER TABLE alert_metric_samples ADD CONSTRAINT alert_metric_samples_metric_check CHECK(metric IN (
  'session_daily_tokens','session_refusal_streak','session_negative_rate',
  'model_5xx_rate','model_p50_ms','model_p95_ms','model_p99_ms','model_qps','model_rate_rejections_5m',
  'evaluation_pass_rate','evaluation_average_score',
  'governance_daily_cost_usd','governance_budget_used_percent'
));
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_metric_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_metric_check CHECK(metric IN (
  'session_daily_tokens','session_refusal_streak','session_negative_rate',
  'model_5xx_rate','model_p50_ms','model_p95_ms','model_p99_ms','model_qps','model_rate_rejections_5m',
  'evaluation_pass_rate','evaluation_average_score',
  'governance_daily_cost_usd','governance_budget_used_percent'
));
