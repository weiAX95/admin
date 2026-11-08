ALTER TABLE project_scans
  ADD COLUMN index_complete boolean NOT NULL DEFAULT false;

-- Old complete scans necessarily had no unindexed paths. Partial scans may
-- have had a complete tree but lacked saved evidence, so leave them unknown.
UPDATE project_scans SET index_complete=true
WHERE status='completed' AND coverage_complete=true;
