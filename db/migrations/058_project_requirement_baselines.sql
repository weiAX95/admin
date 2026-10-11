CREATE TABLE project_requirement_baselines (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  content_sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id,version)
);
CREATE INDEX project_requirement_baselines_repo_created_idx ON project_requirement_baselines(repository_id,created_at DESC);
ALTER TABLE project_repositories ADD COLUMN baseline_version_id uuid REFERENCES project_requirement_baselines(id) ON DELETE SET NULL;
ALTER TABLE project_analyses ADD COLUMN baseline_version_id uuid REFERENCES project_requirement_baselines(id) ON DELETE SET NULL;
