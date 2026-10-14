ALTER TABLE users ADD COLUMN activity_tracking_started_at timestamptz NOT NULL DEFAULT now();
