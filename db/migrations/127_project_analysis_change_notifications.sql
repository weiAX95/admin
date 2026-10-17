ALTER TABLE project_analyses
  ADD COLUMN change_notification_state text NOT NULL DEFAULT 'none'
    CHECK (change_notification_state IN ('none','pending','sent','skipped'));

CREATE INDEX project_analyses_change_notification_pending_idx
  ON project_analyses(finished_at,id)
  WHERE change_notification_state='pending';
