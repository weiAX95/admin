ALTER TABLE project_analyses
  DROP CONSTRAINT project_analyses_analysis_plan_version_check;

ALTER TABLE project_analyses
  ADD CONSTRAINT project_analyses_analysis_plan_version_check
  CHECK (analysis_plan_version BETWEEN 1 AND 19);
