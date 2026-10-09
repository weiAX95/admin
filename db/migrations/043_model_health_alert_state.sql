CREATE TABLE model_health_alert_state (
  model_id text PRIMARY KEY REFERENCES experiment_models(id) ON DELETE CASCADE,
  degraded boolean NOT NULL DEFAULT false,
  generation integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
