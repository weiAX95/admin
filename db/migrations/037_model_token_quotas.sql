CREATE TABLE model_token_quotas (
  model_id text NOT NULL REFERENCES experiment_models(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK(scope IN ('model','role','user')),
  subject_id text NOT NULL,
  daily_tokens bigint NOT NULL CHECK(daily_tokens > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(model_id,scope,subject_id),
  CHECK((scope='model' AND subject_id='*') OR (scope='role' AND subject_id IN ('admin','member')) OR (scope='user' AND subject_id<>'*'))
);
CREATE TABLE model_token_reservations (
  run_id text NOT NULL,
  model_id text NOT NULL REFERENCES experiment_models(id),
  user_id text NOT NULL,
  quota_day date NOT NULL,
  reserved_tokens bigint NOT NULL CHECK(reserved_tokens > 0),
  PRIMARY KEY(run_id,model_id)
);
CREATE INDEX model_token_reservations_usage_idx ON model_token_reservations(model_id,user_id,quota_day);
