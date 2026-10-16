ALTER TABLE project_scans
  ADD COLUMN reused_count integer NOT NULL DEFAULT 0 CHECK (reused_count >= 0),
  ADD COLUMN cache_source_commit_sha char(40);
