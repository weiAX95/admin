ALTER TABLE project_repositories
  ADD COLUMN poll_scan_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN next_poll_at timestamptz;

ALTER TABLE project_scans DROP CONSTRAINT project_scans_trigger_source_check;
ALTER TABLE project_scans ADD CONSTRAINT project_scans_trigger_source_check
  CHECK (trigger_source IN ('manual','webhook','poll'));

CREATE INDEX project_repositories_poll_due_idx ON project_repositories(next_poll_at)
  WHERE poll_scan_enabled=true;
