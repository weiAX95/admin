CREATE TABLE project_scans (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  branch text NOT NULL,
  commit_sha char(40) NOT NULL,
  tree_sha char(40),
  status text NOT NULL CHECK (status IN ('queued','scanning','completed','partial','failed')),
  coverage_complete boolean NOT NULL DEFAULT false,
  read_count integer NOT NULL DEFAULT 0,
  attempted_count integer NOT NULL DEFAULT 0,
  excluded_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  unscanned_count integer NOT NULL DEFAULT 0,
  unscanned_subtrees integer NOT NULL DEFAULT 0,
  total_bytes bigint NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE UNIQUE INDEX project_scans_one_active_idx ON project_scans(repository_id,commit_sha) WHERE status IN ('queued','scanning');
CREATE INDEX project_scans_repository_created_idx ON project_scans(repository_id,created_at DESC);

CREATE TABLE project_scan_files (
  scan_id uuid NOT NULL REFERENCES project_scans(id) ON DELETE CASCADE,
  path text NOT NULL,
  git_sha char(40) NOT NULL,
  byte_size bigint,
  category text NOT NULL,
  status text NOT NULL CHECK (status IN ('read','excluded','failed','unscanned')),
  reason text,
  content_sha256 char(64),
  PRIMARY KEY (scan_id,path)
);
