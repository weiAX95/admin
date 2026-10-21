ALTER TABLE experiment_metric_versions
  ADD COLUMN judge_prompt_version_id text
  REFERENCES prompt_library_versions(id) ON DELETE RESTRICT;

CREATE INDEX experiment_metric_versions_judge_prompt_source_idx
  ON experiment_metric_versions(judge_prompt_version_id)
  WHERE judge_prompt_version_id IS NOT NULL;
