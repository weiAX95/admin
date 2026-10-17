ALTER TABLE project_scans
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3),
  ADD COLUMN next_attempt_at timestamptz;
