ALTER TABLE project_analysis_findings
  ADD COLUMN feature_key text CHECK (feature_key IS NULL OR feature_key ~ '^F-[0-9a-f]{16}$');

CREATE INDEX project_analysis_findings_feature_key_idx
  ON project_analysis_findings(analysis_id,feature_key) WHERE feature_key IS NOT NULL;
