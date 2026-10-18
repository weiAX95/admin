ALTER TABLE project_repositories DROP CONSTRAINT project_auto_analysis_config_check;
ALTER TABLE project_repositories ADD CONSTRAINT project_auto_analysis_config_check CHECK (
  NOT auto_analysis_enabled OR
  (auto_analysis_model_id IS NOT NULL AND auto_analysis_token_budget IS NOT NULL AND auto_analysis_cost_budget_usd IS NOT NULL)
);

ALTER TABLE project_scans DROP CONSTRAINT project_scans_auto_analysis_state_check;
ALTER TABLE project_scans ADD CONSTRAINT project_scans_auto_analysis_state_check
  CHECK (auto_analysis_state IN ('none','pending','processing','approval_required','queued','skipped','failed'));
