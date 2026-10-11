CREATE TABLE project_repository_tasks (
  repository_id uuid NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  linked_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id,task_id)
);
CREATE INDEX project_repository_tasks_task_idx ON project_repository_tasks(task_id);
