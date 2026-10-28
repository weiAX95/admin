ALTER TABLE project_analyses
  ADD CONSTRAINT project_analyses_id_repository_unique UNIQUE (id, repository_id);
ALTER TABLE project_analysis_findings
  ADD CONSTRAINT project_analysis_findings_analysis_id_unique UNIQUE (analysis_id, id);

CREATE TABLE project_finding_matches (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  older_analysis_id uuid NOT NULL,
  newer_analysis_id uuid NOT NULL,
  older_finding_id uuid NOT NULL,
  newer_finding_id uuid NOT NULL,
  reviewer_id text REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (older_analysis_id <> newer_analysis_id),
  FOREIGN KEY (older_analysis_id, repository_id) REFERENCES project_analyses(id, repository_id) ON DELETE CASCADE,
  FOREIGN KEY (newer_analysis_id, repository_id) REFERENCES project_analyses(id, repository_id) ON DELETE CASCADE,
  FOREIGN KEY (older_analysis_id, older_finding_id) REFERENCES project_analysis_findings(analysis_id, id) ON DELETE CASCADE,
  FOREIGN KEY (newer_analysis_id, newer_finding_id) REFERENCES project_analysis_findings(analysis_id, id) ON DELETE CASCADE,
  UNIQUE (older_analysis_id, newer_analysis_id, older_finding_id),
  UNIQUE (older_analysis_id, newer_analysis_id, newer_finding_id)
);
CREATE INDEX project_finding_matches_pair_idx ON project_finding_matches(older_analysis_id, newer_analysis_id, created_at DESC);
