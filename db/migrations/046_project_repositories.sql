CREATE TABLE project_repositories (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  branch text NOT NULL,
  goal text NOT NULL,
  requirement_baseline text NOT NULL DEFAULT '',
  commit_sha char(40) NOT NULL,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX project_repositories_owner_name_branch_idx ON project_repositories(owner_id, lower(full_name), branch);
CREATE INDEX project_repositories_owner_updated_idx ON project_repositories(owner_id, updated_at DESC);
