ALTER TABLE project_analyses
  ADD COLUMN analysis_plan_version smallint NOT NULL DEFAULT 1
  CHECK (analysis_plan_version IN (1, 2));

ALTER TABLE project_analysis_flows
  ALTER COLUMN module_key DROP NOT NULL;

ALTER TABLE project_analysis_flows
  ADD CONSTRAINT project_analysis_flows_analysis_fk
  FOREIGN KEY (analysis_id) REFERENCES project_analyses(id) ON DELETE CASCADE;
