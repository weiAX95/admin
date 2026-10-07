CREATE TABLE experiment_shares (
  id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX experiment_shares_experiment_idx ON experiment_shares(experiment_id,created_at DESC);

CREATE TABLE experiment_schedules (
  id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  owner_id text REFERENCES users(id) ON DELETE SET NULL,
  time_zone text NOT NULL,
  frequency text NOT NULL CHECK(frequency IN ('daily','weekly','monthly')),
  local_time text NOT NULL CHECK(local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  weekday integer CHECK(weekday BETWEEN 0 AND 6),
  day_of_month integer CHECK(day_of_month BETWEEN 1 AND 31),
  variables jsonb NOT NULL,
  retry_limit integer NOT NULL DEFAULT 0 CHECK(retry_limit BETWEEN 0 AND 5),
  active boolean NOT NULL DEFAULT true,
  failure_streak integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((frequency='weekly')=(weekday IS NOT NULL)),
  CHECK((frequency='monthly')=(day_of_month IS NOT NULL))
);
CREATE INDEX experiment_schedules_due_idx ON experiment_schedules(next_run_at) WHERE active;
CREATE TABLE experiment_schedule_occurrences (
  id text PRIMARY KEY,
  schedule_id text NOT NULL REFERENCES experiment_schedules(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  batch_id text UNIQUE REFERENCES experiment_batches(id) ON DELETE SET NULL,
  status text NOT NULL CHECK(status IN ('queued','completed','partial','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(schedule_id,due_at)
);

CREATE TABLE app_notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  entity_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  target_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  email_to text,
  email_status text NOT NULL DEFAULT 'skipped' CHECK(email_status IN ('skipped','pending','sending','sent','failed')),
  email_attempts integer NOT NULL DEFAULT 0,
  email_next_attempt_at timestamptz,
  email_claimed_at timestamptz,
  email_error text,
  UNIQUE(user_id,kind,entity_id)
);
CREATE INDEX app_notifications_unread_idx ON app_notifications(user_id,created_at DESC) WHERE read_at IS NULL;
CREATE INDEX app_notifications_email_idx ON app_notifications(email_next_attempt_at) WHERE email_status IN ('pending','failed');
