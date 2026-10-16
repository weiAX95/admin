ALTER TABLE project_scans
  ADD COLUMN force_full boolean NOT NULL DEFAULT false,
  ADD COLUMN baseline_scan_id uuid REFERENCES project_scans(id) ON DELETE SET NULL,
  ADD COLUMN baseline_commit_sha char(40);

CREATE TABLE project_scan_changes (
  scan_id uuid NOT NULL REFERENCES project_scans(id) ON DELETE CASCADE,
  position integer NOT NULL,
  change_kind text NOT NULL CHECK (change_kind IN ('added','modified','deleted','renamed')),
  path text NOT NULL,
  old_path text,
  old_git_sha char(40),
  new_git_sha char(40),
  PRIMARY KEY (scan_id, position)
);

CREATE INDEX project_scan_changes_kind_idx ON project_scan_changes(scan_id, change_kind);
