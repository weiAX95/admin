ALTER TABLE project_repositories
  ADD COLUMN github_repository_id bigint CHECK (github_repository_id > 0);

-- Existing rows have no trustworthy GitHub ID. Do not silently bind by name.
UPDATE project_repositories SET webhook_scan_enabled=false,auto_analysis_enabled=false,updated_at=now()
  WHERE webhook_scan_enabled=true OR auto_analysis_enabled=true;

ALTER TABLE project_github_webhook_deliveries
  ADD COLUMN payload_repository_id bigint CHECK (payload_repository_id > 0);

ALTER TABLE project_scans
  ADD COLUMN github_repository_id bigint CHECK (github_repository_id > 0);

-- Old scans cannot prove which GitHub repository supplied their bytes.
UPDATE project_analysis_attempts SET status='failed'
  WHERE status IN ('queued','analyzing') AND analysis_id IN (
    SELECT id FROM project_analyses WHERE status IN ('queued','analyzing')
  );
UPDATE project_analyses SET status='failed',error_code='GITHUB_REPOSITORY_IDENTITY_REQUIRED',finished_at=now()
  WHERE status IN ('queued','analyzing');
UPDATE project_scans SET status='failed',error_code='GITHUB_REPOSITORY_IDENTITY_REQUIRED',
  coverage_complete=false,finished_at=now(),
  auto_analysis_state=CASE WHEN auto_analysis_state IN ('pending','processing','approval_required') THEN 'skipped' ELSE auto_analysis_state END,
  auto_analysis_error=CASE WHEN auto_analysis_state IN ('pending','processing','approval_required') THEN '仓库身份待核对，旧扫描未执行' ELSE auto_analysis_error END
  WHERE status IN ('queued','scanning');

CREATE INDEX project_repositories_webhook_identity_idx
  ON project_repositories(github_repository_id,branch)
  WHERE webhook_scan_enabled=true AND github_repository_id IS NOT NULL;
