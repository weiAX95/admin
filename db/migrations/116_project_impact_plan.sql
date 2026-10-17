ALTER TABLE project_analyses
  DROP CONSTRAINT project_analyses_analysis_plan_version_check,
  ADD CONSTRAINT project_analyses_analysis_plan_version_check CHECK (analysis_plan_version IN (1, 2, 3));
