CREATE TABLE model_call_audit (
  request_id uuid PRIMARY KEY,
  run_id text NOT NULL,
  phase text NOT NULL CHECK(phase IN ('main','judge')),
  attempt integer NOT NULL CHECK(attempt > 0),
  user_id text,
  model_id text NOT NULL,
  api_model text NOT NULL,
  module text NOT NULL CHECK(module IN ('experiments','evaluations')),
  provider text NOT NULL,
  prompt_preview text NOT NULL,
  prompt_tokens integer CHECK(prompt_tokens >= 0),
  completion_tokens integer CHECK(completion_tokens >= 0),
  latency_ms integer NOT NULL CHECK(latency_ms >= 0),
  status_code integer NOT NULL CHECK(status_code BETWEEN 0 AND 599),
  succeeded boolean NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_call_audit_time_idx ON model_call_audit(created_at DESC,request_id DESC);
CREATE INDEX model_call_audit_filters_idx ON model_call_audit(model_id,user_id,module,created_at DESC);
