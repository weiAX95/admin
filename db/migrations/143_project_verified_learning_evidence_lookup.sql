CREATE INDEX project_learning_evidence_repository_owner_idx
  ON project_learning_evidence(repository_id, owner_id, created_at DESC, id DESC);

CREATE INDEX project_learning_evidence_reviews_verified_idx
  ON project_learning_evidence_reviews(reviewed_at DESC, evidence_id)
  WHERE state='verified';
