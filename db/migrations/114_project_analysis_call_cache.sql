ALTER TABLE project_analysis_module_calls
  ADD COLUMN input_fingerprint char(64),
  ADD COLUMN reused boolean NOT NULL DEFAULT false,
  ADD COLUMN reused_source_analysis_id uuid,
  ADD COLUMN reused_source_commit_sha char(40);

CREATE INDEX project_analysis_call_cache_idx
  ON project_analysis_module_calls(module_key,input_fingerprint)
  WHERE status='completed' AND input_fingerprint IS NOT NULL;

ALTER TABLE project_analyses
  ADD COLUMN reused_call_count integer NOT NULL DEFAULT 0 CHECK (reused_call_count >= 0),
  ADD COLUMN connection_version integer CHECK (connection_version > 0);
