ALTER TABLE project_github_webhook_deliveries
  ADD COLUMN processing_state text NOT NULL DEFAULT 'completed'
    CHECK (processing_state IN ('queued', 'processing', 'completed', 'failed')),
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN processed_at timestamptz,
  ADD COLUMN resolved_commit_sha char(40),
  ADD COLUMN last_error text;

CREATE INDEX project_github_webhook_deliveries_pending_idx
  ON project_github_webhook_deliveries(next_attempt_at, received_at)
  WHERE processing_state IN ('queued', 'processing');
