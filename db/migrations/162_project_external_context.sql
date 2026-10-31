ALTER TABLE project_repositories
  ADD COLUMN external_context text NOT NULL DEFAULT '',
  ADD CONSTRAINT project_repositories_external_context_length CHECK (char_length(external_context) <= 2000);

ALTER TABLE project_analyses
  ADD COLUMN external_context text NOT NULL DEFAULT '',
  ADD CONSTRAINT project_analyses_external_context_length CHECK (char_length(external_context) <= 2000);

ALTER TABLE project_analyses
  DROP CONSTRAINT project_analyses_analysis_plan_version_check;

ALTER TABLE project_analyses
  ADD CONSTRAINT project_analyses_analysis_plan_version_check
  CHECK (analysis_plan_version BETWEEN 1 AND 22);
