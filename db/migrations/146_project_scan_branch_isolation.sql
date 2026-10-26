DROP INDEX project_scans_one_active_idx;

CREATE UNIQUE INDEX project_scans_one_active_idx
  ON project_scans(repository_id, branch, commit_sha)
  WHERE status IN ('queued','scanning');
