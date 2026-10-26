ALTER TABLE project_analyses
  DROP CONSTRAINT project_analyses_analysis_plan_version_check;

ALTER TABLE project_analyses
  ADD CONSTRAINT project_analyses_analysis_plan_version_check
  CHECK (analysis_plan_version BETWEEN 1 AND 11);

ALTER TABLE project_analyses
  ADD COLUMN duplicate_candidates jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(duplicate_candidates) = 'array');

ALTER TABLE project_analysis_suggestions
  ADD COLUMN semantic_duplicate_task_id text,
  ADD COLUMN semantic_duplicate_reason text,
  ADD CONSTRAINT project_suggestions_semantic_duplicate_pair_check
    CHECK ((semantic_duplicate_task_id IS NULL) = (semantic_duplicate_reason IS NULL));
