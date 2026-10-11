ALTER TABLE project_analysis_modules ADD COLUMN summary text;
ALTER TABLE project_analysis_findings ADD COLUMN module_key text;
ALTER TABLE project_analysis_findings ADD CONSTRAINT project_analysis_findings_module_fk
  FOREIGN KEY (analysis_id,module_key) REFERENCES project_analysis_modules(analysis_id,module_key) ON DELETE CASCADE;

CREATE TABLE project_analysis_model_charges (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL,
  attempt integer NOT NULL,
  module_key text,
  prompt_tokens integer NOT NULL CHECK (prompt_tokens >= 0),
  completion_tokens integer NOT NULL CHECK (completion_tokens >= 0),
  cost_usd numeric(14,6) NOT NULL CHECK (cost_usd >= 0),
  charged_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (analysis_id,attempt) REFERENCES project_analysis_attempts(analysis_id,attempt) ON DELETE CASCADE
);
CREATE INDEX project_analysis_model_charges_day_idx ON project_analysis_model_charges(charged_at);
INSERT INTO project_analysis_model_charges(id,analysis_id,attempt,prompt_tokens,completion_tokens,cost_usd,charged_at)
SELECT gen_random_uuid(),analysis_id,attempt,COALESCE(prompt_tokens,0),COALESCE(completion_tokens,0),cost_usd,COALESCE(charged_at,started_at)
FROM project_analysis_attempts WHERE cost_usd IS NOT NULL;
