CREATE TABLE project_suggestion_adjustments (
  suggestion_id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL,
  repository_id uuid NOT NULL,
  owner_id text NOT NULL,
  practice text NOT NULL CHECK (char_length(practice) BETWEEN 10 AND 2000),
  acceptance text NOT NULL CHECK (char_length(acceptance) BETWEEN 10 AND 2000),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 10 AND 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (suggestion_id,analysis_id)
    REFERENCES project_analysis_suggestions(id,analysis_id) ON DELETE CASCADE,
  FOREIGN KEY (analysis_id,repository_id,owner_id)
    REFERENCES project_analyses(id,repository_id,owner_id) ON DELETE CASCADE
);
CREATE INDEX project_suggestion_adjustments_analysis_idx
  ON project_suggestion_adjustments(analysis_id,owner_id);
