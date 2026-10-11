CREATE INDEX project_analyses_latest_completed_idx
  ON project_analyses(repository_id,finished_at DESC,created_at DESC)
  WHERE status='completed' AND finished_at IS NOT NULL;
