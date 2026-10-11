CREATE TABLE project_analyses (
  id uuid PRIMARY KEY,
  repository_id uuid NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES project_scans(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  branch text NOT NULL,
  commit_sha char(40) NOT NULL,
  goal text NOT NULL,
  requirement_baseline text NOT NULL,
  model_id text NOT NULL REFERENCES experiment_models(id),
  provider text NOT NULL,
  api_model text NOT NULL,
  connection_id text,
  input_price numeric(14,6) NOT NULL,
  output_price numeric(14,6) NOT NULL,
  estimated_max_cost_usd numeric(14,6) NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','analyzing','completed','failed')),
  error_code text,
  summary text,
  selected_file_count integer NOT NULL DEFAULT 0,
  available_file_count integer NOT NULL DEFAULT 0,
  analysis_coverage_complete boolean NOT NULL DEFAULT false,
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric(14,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE UNIQUE INDEX project_analyses_one_active_idx ON project_analyses(scan_id,model_id) WHERE status IN ('queued','analyzing');
CREATE INDEX project_analyses_repository_created_idx ON project_analyses(repository_id,created_at DESC);

CREATE TABLE project_analysis_findings (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES project_analyses(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('implemented','partial','not_found','unverified')),
  detail text NOT NULL,
  evidence_type text CHECK (evidence_type IN ('code','test','document')),
  evidence_path text,
  evidence_line integer CHECK (evidence_line > 0),
  evidence_excerpt text,
  evidence_git_sha char(40),
  UNIQUE(analysis_id,position)
);
CREATE TABLE project_analysis_suggestions (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES project_analyses(id) ON DELETE CASCADE,
  finding_id uuid REFERENCES project_analysis_findings(id) ON DELETE SET NULL,
  position integer NOT NULL,
  topic text NOT NULL,
  reason text NOT NULL,
  practice text NOT NULL,
  acceptance text NOT NULL,
  UNIQUE(analysis_id,position)
);
