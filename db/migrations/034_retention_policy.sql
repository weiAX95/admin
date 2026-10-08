CREATE TABLE retention_settings (
  id integer PRIMARY KEY CHECK(id=1),
  version integer NOT NULL DEFAULT 1,
  audit_days integer NOT NULL DEFAULT 90 CHECK(audit_days BETWEEN 30 AND 365),
  session_days integer NOT NULL DEFAULT 180 CHECK(session_days BETWEEN 7 AND 730),
  recycle_days integer NOT NULL DEFAULT 30 CHECK(recycle_days=0 OR recycle_days BETWEEN 7 AND 90),
  cleanup_local_time time NOT NULL DEFAULT '03:00',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO retention_settings(id) VALUES(1);
CREATE TABLE retention_cleanup_runs (
  local_date date PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  audit_deleted integer NOT NULL DEFAULT 0,
  sessions_deleted integer NOT NULL DEFAULT 0,
  candidates_deleted integer NOT NULL DEFAULT 0,
  notes_deleted integer NOT NULL DEFAULT 0,
  tasks_deleted integer NOT NULL DEFAULT 0,
  experiments_deleted integer NOT NULL DEFAULT 0,
  prompts_deleted integer NOT NULL DEFAULT 0
);
