ALTER TABLE project_scans
  ADD COLUMN trigger_source text NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual','webhook'));

CREATE INDEX project_scans_webhook_queued_idx
  ON project_scans(repository_id,created_at DESC)
  WHERE trigger_source='webhook' AND status='queued';
