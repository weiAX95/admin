ALTER TABLE alert_metric_samples DROP CONSTRAINT alert_metric_samples_metric_check;
ALTER TABLE alert_metric_samples ADD CONSTRAINT alert_metric_samples_metric_check CHECK(metric IN (
  'session_daily_tokens','session_refusal_streak','session_refusal_rate','session_negative_rate',
  'model_5xx_rate','model_p50_ms','model_p95_ms','model_p99_ms','model_qps','model_rate_rejections_5m',
  'evaluation_pass_rate','evaluation_average_score',
  'governance_daily_cost_usd','governance_budget_used_percent'
));
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_metric_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_metric_check CHECK(metric IN (
  'session_daily_tokens','session_refusal_streak','session_refusal_rate','session_negative_rate',
  'model_5xx_rate','model_p50_ms','model_p95_ms','model_p99_ms','model_qps','model_rate_rejections_5m',
  'evaluation_pass_rate','evaluation_average_score',
  'governance_daily_cost_usd','governance_budget_used_percent'
));
CREATE INDEX session_messages_alert_assistant_at_idx ON session_messages(at,session_id,id)
  WHERE role='assistant';
