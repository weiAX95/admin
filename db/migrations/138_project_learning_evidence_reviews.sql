-- Review is requested by the evidence owner and completed by a different
-- active administrator. The original self-reported evidence stays immutable.
ALTER TABLE project_learning_evidence
  ADD CONSTRAINT project_learning_evidence_id_owner_unique UNIQUE (id, owner_id);

CREATE TABLE project_learning_evidence_reviews (
  evidence_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'verified', 'needs_revision')),
  reviewer_id text REFERENCES users(id) ON DELETE SET NULL,
  core_correct boolean,
  boundary_verified boolean,
  rationale text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  FOREIGN KEY (evidence_id, owner_id)
    REFERENCES project_learning_evidence(id, owner_id) ON DELETE CASCADE,
  CHECK (reviewer_id IS NULL OR reviewer_id <> owner_id),
  CHECK (
    (state = 'pending' AND reviewer_id IS NULL AND core_correct IS NULL
      AND boundary_verified IS NULL AND rationale IS NULL AND reviewed_at IS NULL)
    OR
    (state <> 'pending' AND core_correct IS NOT NULL AND boundary_verified IS NOT NULL
      AND rationale IS NOT NULL AND char_length(rationale) BETWEEN 20 AND 2000
      AND reviewed_at IS NOT NULL)
  ),
  CHECK (state = 'pending' OR (state = 'verified') = (core_correct AND boundary_verified))
);

CREATE INDEX project_learning_evidence_reviews_pending_idx
  ON project_learning_evidence_reviews(requested_at, evidence_id)
  WHERE state = 'pending';
