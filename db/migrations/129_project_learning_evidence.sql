CREATE TABLE project_learning_evidence (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL,
  analysis_id uuid NOT NULL,
  suggestion_id uuid NOT NULL,
  owner_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('understanding','practice')),
  response text NOT NULL CHECK (char_length(response) BETWEEN 20 AND 4000),
  artifact_url text CHECK (artifact_url IS NULL OR char_length(artifact_url) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (analysis_id,repository_id,owner_id)
    REFERENCES project_analyses(id,repository_id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY (suggestion_id,analysis_id)
    REFERENCES project_analysis_suggestions(id,analysis_id) ON DELETE CASCADE
);
CREATE INDEX project_learning_evidence_owner_idx
  ON project_learning_evidence(analysis_id,owner_id,suggestion_id,created_at DESC,id DESC);
