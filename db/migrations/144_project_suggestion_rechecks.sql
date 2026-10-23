-- Human review of an older suggestion against a later completed report.
-- This is deliberately separate from accepting/ignoring a suggestion as a task.
CREATE TABLE project_suggestion_rechecks (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL,
  owner_id text NOT NULL,
  older_analysis_id uuid NOT NULL,
  newer_analysis_id uuid NOT NULL,
  older_suggestion_id uuid NOT NULL,
  newer_suggestion_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('matched','follow_up','no_longer_relevant')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (older_suggestion_id,newer_analysis_id),
  CHECK (
    (outcome='matched' AND newer_suggestion_id IS NOT NULL)
    OR (outcome='follow_up')
    OR (outcome='no_longer_relevant' AND newer_suggestion_id IS NULL)
  ),
  FOREIGN KEY (older_analysis_id,repository_id,owner_id)
    REFERENCES project_analyses(id,repository_id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY (newer_analysis_id,repository_id,owner_id)
    REFERENCES project_analyses(id,repository_id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY (older_suggestion_id,older_analysis_id)
    REFERENCES project_analysis_suggestions(id,analysis_id) ON DELETE CASCADE,
  FOREIGN KEY (newer_suggestion_id,newer_analysis_id)
    REFERENCES project_analysis_suggestions(id,analysis_id) ON DELETE CASCADE
);
CREATE INDEX project_suggestion_rechecks_newer_idx
  ON project_suggestion_rechecks(newer_analysis_id,older_analysis_id);

-- Keep the full edit trail even though the current decision is a versioned upsert.
CREATE TABLE project_suggestion_recheck_events (
  recheck_id uuid NOT NULL REFERENCES project_suggestion_rechecks(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  newer_suggestion_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('matched','follow_up','no_longer_relevant')),
  note text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recheck_id,version)
);
