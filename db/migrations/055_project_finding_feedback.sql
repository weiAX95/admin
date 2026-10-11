CREATE TABLE project_finding_feedback (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES project_analyses(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES project_analysis_findings(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corrected_status text NOT NULL CHECK (corrected_status IN ('implemented','partial','not_found','unverified')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_finding_feedback_latest_idx ON project_finding_feedback(finding_id,created_at DESC,id DESC);
