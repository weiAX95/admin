ALTER TABLE project_repository_tasks
  ADD COLUMN requirement_id text CHECK (requirement_id IS NULL OR char_length(requirement_id) BETWEEN 1 AND 64);

CREATE TABLE project_analysis_task_snapshots (
  analysis_id uuid NOT NULL REFERENCES project_analyses(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  requirement_id text,
  title text NOT NULL,
  status text NOT NULL,
  progress numeric,
  owner_id text,
  task_version integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (analysis_id, task_id),
  CHECK (progress IS NULL OR progress BETWEEN 0 AND 100)
);

CREATE INDEX project_analysis_task_snapshots_requirement_idx
  ON project_analysis_task_snapshots (analysis_id, requirement_id);
