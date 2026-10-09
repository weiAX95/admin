CREATE TABLE model_rate_limits (
  model_id text PRIMARY KEY REFERENCES experiment_models(id) ON DELETE CASCADE,
  rpm integer NOT NULL CHECK(rpm > 0 AND rpm <= 1000000),
  tpm bigint NOT NULL CHECK(tpm > 0 AND tpm <= 1000000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE model_rate_reservations (
  run_id text NOT NULL,
  model_id text NOT NULL REFERENCES experiment_models(id),
  window_start timestamptz NOT NULL,
  reserved_requests integer NOT NULL CHECK(reserved_requests > 0),
  reserved_tokens bigint NOT NULL CHECK(reserved_tokens > 0),
  PRIMARY KEY(run_id,model_id)
);
CREATE INDEX model_rate_reservations_window_idx ON model_rate_reservations(model_id,window_start);
