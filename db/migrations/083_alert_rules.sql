CREATE TABLE alert_rules (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 120),
  template_key text UNIQUE,
  metric text NOT NULL CHECK(metric IN (
    'session_daily_tokens','session_refusal_streak','session_negative_rate',
    'model_5xx_rate','model_p50_ms','model_p95_ms','model_p99_ms','model_qps',
    'evaluation_pass_rate','evaluation_average_score',
    'governance_daily_cost_usd','governance_budget_used_percent'
  )),
  scope_type text NOT NULL CHECK(scope_type IN ('global','model')),
  scope_id text NOT NULL DEFAULT '*',
  operator text NOT NULL CHECK(operator IN ('>','<','=','>=','<=')),
  threshold numeric(20,6) NOT NULL,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK(duration_seconds BETWEEN 0 AND 86400),
  level text NOT NULL CHECK(level IN ('info','warning','critical')),
  channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[]
    CHECK(channels <@ ARRAY['in_app','email']::text[]),
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(scope_id <> ''),
  CHECK((scope_type='model') = (metric LIKE 'model_%'))
);

CREATE TABLE alert_rule_state (
  rule_id text NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  scope_id text NOT NULL,
  first_breached_at timestamptz,
  last_sample_at timestamptz NOT NULL,
  PRIMARY KEY(rule_id,scope_id)
);

CREATE TABLE alert_incidents (
  id text PRIMARY KEY,
  rule_id text REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_name text NOT NULL,
  metric text NOT NULL,
  scope_id text NOT NULL,
  level text NOT NULL CHECK(level IN ('info','warning','critical')),
  status text NOT NULL DEFAULT 'firing' CHECK(status IN ('firing','acknowledged','resolved')),
  trigger_value numeric(20,6) NOT NULL,
  trigger_count integer NOT NULL DEFAULT 1 CHECK(trigger_count > 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by text REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_note text,
  CHECK((status='resolved')=(resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX alert_incidents_one_active_idx ON alert_incidents(rule_id,scope_id)
  WHERE status IN ('firing','acknowledged') AND rule_id IS NOT NULL;
CREATE INDEX alert_incidents_history_idx ON alert_incidents(opened_at DESC);

INSERT INTO alert_rules(id,name,template_key,metric,scope_type,operator,threshold,duration_seconds,level,channels)
VALUES
  ('builtin-daily-tokens','日 token 消耗','daily_tokens','session_daily_tokens','global','>',100000,0,'warning',ARRAY['in_app']),
  ('builtin-model-errors','模型 HTTP 5xx 错误率','model_errors','model_5xx_rate','model','>',5,0,'critical',ARRAY['in_app','email']),
  ('builtin-evaluation-pass','评测通过率','evaluation_pass','evaluation_pass_rate','global','<',80,0,'warning',ARRAY['in_app']),
  ('builtin-session-refusal','连续 5 个会话含拒答','session_refusal','session_refusal_streak','global','>=',5,0,'warning',ARRAY['in_app']),
  ('builtin-model-latency','模型 P95 延迟','model_latency','model_p95_ms','model','>',10000,0,'warning',ARRAY['in_app']),
  ('builtin-negative-rate','用户负面标注率','negative_rate','session_negative_rate','global','>',10,0,'warning',ARRAY['in_app']),
  ('builtin-budget-80','预算使用达 80%','budget_80','governance_budget_used_percent','global','>=',80,0,'warning',ARRAY['in_app']),
  ('builtin-budget-100','预算使用达 100%','budget_100','governance_budget_used_percent','global','>=',100,0,'critical',ARRAY['in_app','email']);
