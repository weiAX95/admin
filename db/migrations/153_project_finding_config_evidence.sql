ALTER TABLE project_analysis_findings
  DROP CONSTRAINT project_analysis_findings_evidence_type_check;

ALTER TABLE project_analysis_findings
  ADD CONSTRAINT project_analysis_findings_evidence_type_check
  CHECK (evidence_type IN ('code','test','document','config'));
