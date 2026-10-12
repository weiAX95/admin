CREATE TABLE project_analysis_flows (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL,
  module_key text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  UNIQUE (analysis_id, position),
  FOREIGN KEY (analysis_id, module_key)
    REFERENCES project_analysis_modules (analysis_id, module_key) ON DELETE CASCADE
);

CREATE TABLE project_analysis_flow_steps (
  flow_id uuid NOT NULL REFERENCES project_analysis_flows(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
  evidence_type text NOT NULL CHECK (evidence_type IN ('code', 'test')),
  evidence_path text NOT NULL,
  evidence_line integer NOT NULL CHECK (evidence_line > 0),
  evidence_excerpt text NOT NULL,
  evidence_git_sha char(40) NOT NULL,
  PRIMARY KEY (flow_id, position)
);

CREATE INDEX project_analysis_flows_analysis_idx ON project_analysis_flows (analysis_id, position);
