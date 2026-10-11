ALTER TABLE project_analyses DROP CONSTRAINT project_analyses_status_check;
ALTER TABLE project_analyses ADD CONSTRAINT project_analyses_status_check CHECK (status IN ('queued','analyzing','completed','failed','canceled'));
ALTER TABLE project_analyses ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0);
ALTER TABLE project_analyses ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10);
ALTER TABLE project_analyses ADD COLUMN canceled_at timestamptz;
UPDATE project_analyses SET attempts=1 WHERE status IN ('analyzing','completed','failed');

CREATE TABLE project_analysis_attempts (
  analysis_id uuid NOT NULL REFERENCES project_analyses(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  estimated_max_cost_usd numeric(14,6) NOT NULL CHECK (estimated_max_cost_usd >= 0),
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric(14,6),
  charged_at timestamptz,
  status text NOT NULL CHECK (status IN ('queued','analyzing','completed','failed','canceled')),
  PRIMARY KEY (analysis_id,attempt)
);
CREATE INDEX project_analysis_attempts_charged_idx ON project_analysis_attempts(charged_at);
CREATE INDEX project_analysis_attempts_active_idx ON project_analysis_attempts(status) WHERE status IN ('queued','analyzing');
INSERT INTO project_analysis_attempts(analysis_id,attempt,started_at,estimated_max_cost_usd,prompt_tokens,completion_tokens,cost_usd,charged_at,status)
SELECT id,1,COALESCE(started_at,created_at),estimated_max_cost_usd,prompt_tokens,completion_tokens,cost_usd,CASE WHEN cost_usd IS NOT NULL THEN COALESCE(finished_at,started_at,created_at) END,status
FROM project_analyses;
