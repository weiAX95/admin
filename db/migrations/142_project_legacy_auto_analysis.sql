-- Previously completed scans may still be awaiting automatic analysis.
-- Their source repository cannot be established from a name alone.
UPDATE project_scans SET auto_analysis_state='skipped',
  auto_analysis_error='旧扫描缺少可信仓库身份，请核对仓库并重新扫描',
  auto_analysis_started_at=NULL
WHERE github_repository_id IS NULL
  AND auto_analysis_state IN ('pending','processing','approval_required');
