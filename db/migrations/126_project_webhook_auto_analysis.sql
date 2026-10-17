ALTER TABLE project_repositories
  ADD COLUMN auto_analysis_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_analysis_model_id text REFERENCES experiment_models(id) ON DELETE RESTRICT,
  ADD COLUMN auto_analysis_token_budget integer CHECK (auto_analysis_token_budget IN (30000,60000,120000)),
  ADD COLUMN auto_analysis_cost_budget_usd numeric(10,2) CHECK (auto_analysis_cost_budget_usd IN (0.10,0.50,1.00,5.00)),
  ADD CONSTRAINT project_auto_analysis_config_check CHECK (
    NOT auto_analysis_enabled OR
    (NOT is_private AND auto_analysis_model_id IS NOT NULL AND auto_analysis_token_budget IS NOT NULL AND auto_analysis_cost_budget_usd IS NOT NULL)
  );

ALTER TABLE project_scans
  ADD COLUMN auto_analysis_state text NOT NULL DEFAULT 'none'
    CHECK (auto_analysis_state IN ('none','pending','processing','queued','skipped','failed')),
  ADD COLUMN auto_analysis_error text,
  ADD COLUMN auto_analysis_started_at timestamptz,
  ADD COLUMN auto_analysis_id uuid;

CREATE INDEX project_scans_auto_analysis_pending_idx
  ON project_scans(created_at,id)
  WHERE trigger_source='webhook' AND auto_analysis_state IN ('pending','processing');

ALTER TABLE project_analyses
  ADD COLUMN trigger_source text NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual','webhook'));
CREATE UNIQUE INDEX project_analyses_one_webhook_per_scan_idx
  ON project_analyses(scan_id) WHERE trigger_source='webhook';
