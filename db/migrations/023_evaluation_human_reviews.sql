CREATE TABLE evaluation_review_tasks (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES experiment_batches(id) ON DELETE CASCADE,
  dataset_version_id text NOT NULL REFERENCES experiment_dataset_versions(id),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  rubric jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evaluation_review_assignments (
  task_id text NOT NULL REFERENCES evaluation_review_tasks(id) ON DELETE CASCADE,
  reviewer_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('primary','adjudicator')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id,reviewer_id)
);
CREATE INDEX evaluation_review_assignments_reviewer_idx ON evaluation_review_assignments(reviewer_id);
CREATE TABLE evaluation_review_scores (
  task_id text NOT NULL,
  run_id text NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  reviewer_id text NOT NULL,
  accuracy smallint NOT NULL CHECK(accuracy BETWEEN 0 AND 10),
  completeness smallint NOT NULL CHECK(completeness BETWEEN 0 AND 10),
  brevity smallint NOT NULL CHECK(brevity BETWEEN 0 AND 10),
  safety smallint NOT NULL CHECK(safety BETWEEN 0 AND 10),
  tags text[] NOT NULL DEFAULT '{}',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id,run_id,reviewer_id),
  FOREIGN KEY(task_id,reviewer_id) REFERENCES evaluation_review_assignments(task_id,reviewer_id) ON DELETE CASCADE
);
CREATE INDEX evaluation_review_scores_run_idx ON evaluation_review_scores(run_id);
