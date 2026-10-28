ALTER TABLE project_analyses
  DROP CONSTRAINT project_analyses_analysis_plan_version_check;

ALTER TABLE project_analyses
  ADD CONSTRAINT project_analyses_analysis_plan_version_check
  CHECK (analysis_plan_version BETWEEN 1 AND 12);

ALTER TABLE project_analysis_suggestions
  ADD COLUMN dependency_positions integer[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(dependency_positions) <= 3);
