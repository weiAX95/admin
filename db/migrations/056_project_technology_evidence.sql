CREATE TABLE project_analysis_technologies (
  analysis_id uuid NOT NULL REFERENCES project_analyses(id) ON DELETE CASCADE,
  name text NOT NULL,
  package_name text NOT NULL,
  evidence_path text NOT NULL,
  evidence_line integer NOT NULL CHECK (evidence_line > 0),
  evidence_excerpt text NOT NULL,
  evidence_git_sha char(40) NOT NULL,
  PRIMARY KEY (analysis_id,name)
);
