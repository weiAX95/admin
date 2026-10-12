CREATE TABLE project_analysis_module_calls (
  analysis_id uuid NOT NULL,
  attempt integer NOT NULL,
  module_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('started','completed')),
  response_output text,
  prompt_tokens integer CHECK (prompt_tokens >= 0),
  completion_tokens integer CHECK (completion_tokens >= 0),
  cost_usd numeric(14,6) CHECK (cost_usd >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (analysis_id,attempt,module_key),
  FOREIGN KEY (analysis_id,attempt) REFERENCES project_analysis_attempts(analysis_id,attempt) ON DELETE CASCADE,
  CONSTRAINT project_analysis_call_complete CHECK (status <> 'completed' OR (response_output IS NOT NULL AND prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL))
);

-- Before this migration, an in-flight call has no durable started marker.
-- Its outcome cannot be inferred safely, so never auto-reissue it on restart.
UPDATE project_analysis_attempts a SET status='failed'
FROM project_analyses p WHERE p.id=a.analysis_id AND a.attempt=p.attempts AND p.status='analyzing';
UPDATE project_analyses SET status='failed',error_code='CALL_OUTCOME_UNKNOWN',finished_at=now()
WHERE status='analyzing';
