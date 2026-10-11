CREATE TABLE project_suggestion_decisions (
  suggestion_id uuid PRIMARY KEY REFERENCES project_analysis_suggestions(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES project_analyses(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('accepted','ignored')),
  task_id text REFERENCES tasks(id) ON DELETE SET NULL,
  fingerprint char(64) NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'ignored' OR task_id IS NULL)
);
CREATE UNIQUE INDEX project_suggestion_accepted_unique ON project_suggestion_decisions(owner_id,repository_id,fingerprint) WHERE state='accepted';
CREATE INDEX project_suggestion_decisions_analysis_idx ON project_suggestion_decisions(analysis_id);
