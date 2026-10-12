-- A versioned requirement or finding belongs to exactly one repository or
-- analysis. Do not let independent, individually valid IDs form a false report.
ALTER TABLE project_requirement_baselines
  ADD CONSTRAINT project_requirement_baselines_id_repository_unique UNIQUE (id, repository_id);

ALTER TABLE project_repositories
  ADD CONSTRAINT project_repositories_baseline_repository_fk
    FOREIGN KEY (baseline_version_id, id)
    REFERENCES project_requirement_baselines (id, repository_id)
    ON DELETE SET NULL (baseline_version_id);

ALTER TABLE project_analyses
  ADD CONSTRAINT project_analyses_baseline_repository_fk
    FOREIGN KEY (baseline_version_id, repository_id)
    REFERENCES project_requirement_baselines (id, repository_id)
    ON DELETE SET NULL (baseline_version_id),
  ADD CONSTRAINT project_analyses_id_owner_unique UNIQUE (id, owner_id);

ALTER TABLE project_analysis_findings
  ADD CONSTRAINT project_analysis_findings_id_analysis_unique UNIQUE (id, analysis_id);

ALTER TABLE project_analysis_suggestions
  ADD CONSTRAINT project_analysis_suggestions_finding_analysis_fk
    FOREIGN KEY (finding_id, analysis_id)
    REFERENCES project_analysis_findings (id, analysis_id)
    ON DELETE SET NULL (finding_id);

ALTER TABLE project_finding_feedback
  ADD CONSTRAINT project_finding_feedback_finding_analysis_fk
    FOREIGN KEY (finding_id, analysis_id)
    REFERENCES project_analysis_findings (id, analysis_id) ON DELETE CASCADE,
  ADD CONSTRAINT project_finding_feedback_analysis_owner_fk
    FOREIGN KEY (analysis_id, owner_id)
    REFERENCES project_analyses (id, owner_id) ON DELETE CASCADE;
