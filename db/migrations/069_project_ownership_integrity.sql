-- Keep project analysis ownership and provenance consistent even if a future
-- writer bypasses the HTTP authorization checks. Existing mismatches make this
-- migration fail instead of silently reassigning historical reports.
ALTER TABLE project_repositories
  ADD CONSTRAINT project_repositories_id_owner_unique UNIQUE (id, owner_id);

ALTER TABLE project_scans
  ADD CONSTRAINT project_scans_id_repository_unique UNIQUE (id, repository_id);

ALTER TABLE project_analyses
  ADD CONSTRAINT project_analyses_repository_owner_fk
    FOREIGN KEY (repository_id, owner_id)
    REFERENCES project_repositories (id, owner_id) ON DELETE CASCADE,
  ADD CONSTRAINT project_analyses_scan_repository_fk
    FOREIGN KEY (scan_id, repository_id)
    REFERENCES project_scans (id, repository_id) ON DELETE CASCADE,
  ADD CONSTRAINT project_analyses_id_repository_owner_unique
    UNIQUE (id, repository_id, owner_id);

ALTER TABLE project_analysis_suggestions
  ADD CONSTRAINT project_analysis_suggestions_id_analysis_unique UNIQUE (id, analysis_id);

ALTER TABLE project_suggestion_decisions
  ADD CONSTRAINT project_suggestion_decisions_suggestion_analysis_fk
    FOREIGN KEY (suggestion_id, analysis_id)
    REFERENCES project_analysis_suggestions (id, analysis_id) ON DELETE CASCADE,
  ADD CONSTRAINT project_suggestion_decisions_analysis_owner_fk
    FOREIGN KEY (analysis_id, repository_id, owner_id)
    REFERENCES project_analyses (id, repository_id, owner_id) ON DELETE CASCADE;
