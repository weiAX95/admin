CREATE TABLE evaluation_schedules (
  id text PRIMARY KEY,
  owner_id text REFERENCES users(id) ON DELETE CASCADE,
  experiment_id text NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_id text NOT NULL REFERENCES experiment_variants(id),
  dataset_version_id text NOT NULL REFERENCES experiment_dataset_versions(id),
  metric_version_id text NOT NULL REFERENCES experiment_metric_versions(id),
  time_zone text NOT NULL,
  frequency text NOT NULL CHECK(frequency IN ('daily','weekly')),
  local_time text NOT NULL,
  weekday smallint CHECK(weekday BETWEEN 0 AND 6),
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evaluation_schedules_due_idx ON evaluation_schedules(next_run_at) WHERE active;
CREATE TABLE evaluation_schedule_occurrences (
  id text PRIMARY KEY,
  schedule_id text NOT NULL REFERENCES evaluation_schedules(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  batch_id text REFERENCES experiment_batches(id) ON DELETE SET NULL,
  status text NOT NULL CHECK(status IN ('queued','completed','partial','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(schedule_id,due_at)
);
