ALTER TABLE project_analysis_findings ADD COLUMN requirement_id text;
CREATE INDEX project_analysis_findings_requirement_idx ON project_analysis_findings(analysis_id,requirement_id) WHERE requirement_id IS NOT NULL;
