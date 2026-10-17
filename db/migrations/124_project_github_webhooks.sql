ALTER TABLE project_repositories
  ADD COLUMN webhook_scan_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE project_github_webhook_deliveries (
  delivery_id uuid PRIMARY KEY,
  event_type text NOT NULL,
  repository_full_name text,
  branch text,
  commit_sha char(40),
  scan_count integer NOT NULL DEFAULT 0 CHECK (scan_count >= 0),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_github_webhook_deliveries_received_idx
  ON project_github_webhook_deliveries(received_at DESC);

CREATE INDEX project_repositories_webhook_scan_idx
  ON project_repositories(lower(full_name),branch) WHERE webhook_scan_enabled;
