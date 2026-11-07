ALTER TABLE project_analyses DROP CONSTRAINT project_analyses_trigger_source_check;
ALTER TABLE project_analyses ADD CONSTRAINT project_analyses_trigger_source_check
  CHECK (trigger_source IN ('manual','webhook','poll'));

DROP INDEX project_analyses_one_webhook_per_scan_idx;
CREATE UNIQUE INDEX project_analyses_one_automatic_per_scan_idx
  ON project_analyses(scan_id) WHERE trigger_source IN ('webhook','poll');

DROP INDEX project_scans_auto_analysis_pending_idx;
CREATE INDEX project_scans_auto_analysis_pending_idx ON project_scans(created_at,id)
  WHERE trigger_source IN ('webhook','poll') AND auto_analysis_state IN ('pending','processing');
