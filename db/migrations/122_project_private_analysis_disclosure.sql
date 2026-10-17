ALTER TABLE project_analyses
  ADD COLUMN private_disclosure jsonb;
CREATE INDEX project_analyses_private_disclosure_idx ON project_analyses(repository_id)
  WHERE private_disclosure IS NOT NULL;
