CREATE TABLE backup_jobs (
  id uuid PRIMARY KEY,
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  phase text NOT NULL CHECK (phase IN ('queued','dumping','verifying','completed','failed')),
  file_size bigint CHECK (file_size >= 0),
  file_count integer CHECK (file_count >= 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX backup_jobs_one_active_idx ON backup_jobs ((true)) WHERE status IN ('queued','running');
CREATE INDEX backup_jobs_created_idx ON backup_jobs(created_at DESC);
