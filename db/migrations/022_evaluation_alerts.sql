CREATE TABLE evaluation_alerts (
  id text PRIMARY KEY,
  batch_id text NOT NULL UNIQUE REFERENCES experiment_batches(id) ON DELETE CASCADE,
  baseline_batch_id text REFERENCES experiment_batches(id) ON DELETE SET NULL,
  metric_version_id text NOT NULL REFERENCES experiment_metric_versions(id),
  affected_count integer NOT NULL CHECK(affected_count > 0),
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
