CREATE TABLE task_dependency_restore_edges (
  deleted_task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependent_task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  original_position integer NOT NULL CHECK (original_position >= 0),
  expected_dependency_ids jsonb NOT NULL CHECK (jsonb_typeof(expected_dependency_ids)='array'),
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deleted_task_id, dependent_task_id),
  CHECK (deleted_task_id <> dependent_task_id)
);

CREATE INDEX task_dependency_restore_edges_dependent_idx
  ON task_dependency_restore_edges (dependent_task_id);
