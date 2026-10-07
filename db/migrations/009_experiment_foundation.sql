ALTER TABLE users ADD COLUMN time_zone text NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE experiments ADD COLUMN owner_id text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE experiments ADD COLUMN record_kind text NOT NULL DEFAULT 'manual' CHECK (record_kind IN ('manual','definition'));
ALTER TABLE experiments ADD COLUMN system_prompt text NOT NULL DEFAULT '';
ALTER TABLE experiments ADD COLUMN user_prompt text NOT NULL DEFAULT '';
ALTER TABLE experiments ADD COLUMN prompt_version_id text;
ALTER TABLE experiments ADD COLUMN variables jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE experiments ADD COLUMN chain_id text;

CREATE TABLE experiment_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  daily_budget_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK (daily_budget_usd >= 0),
  concurrency_limit integer NOT NULL DEFAULT 0 CHECK (concurrency_limit BETWEEN 0 AND 20),
  judge_model_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO experiment_settings(id) VALUES(1);

CREATE TABLE experiment_models (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  api_model text NOT NULL UNIQUE,
  input_usd_per_million numeric(14,6) NOT NULL CHECK (input_usd_per_million >= 0),
  output_usd_per_million numeric(14,6) NOT NULL CHECK (output_usd_per_million >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prompt_library (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE prompt_library_versions (
  id text PRIMARY KEY,
  prompt_id text NOT NULL REFERENCES prompt_library(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(prompt_id,version)
);
ALTER TABLE experiments ADD CONSTRAINT experiments_prompt_version_fk FOREIGN KEY(prompt_version_id) REFERENCES prompt_library_versions(id) ON DELETE SET NULL;

CREATE TABLE experiment_variants (
  id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  model_id text NOT NULL REFERENCES experiment_models(id),
  label text NOT NULL,
  parameters jsonb NOT NULL,
  position integer NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX experiment_variants_experiment_idx ON experiment_variants(experiment_id);
CREATE UNIQUE INDEX experiment_variants_active_position_idx ON experiment_variants(experiment_id,position) WHERE active;

CREATE TABLE experiment_batches (
  id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  owner_id text REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK(kind IN ('single','ab','regression','scheduled')),
  status text NOT NULL CHECK(status IN ('queued','running','completed','partial','failed')),
  inputs jsonb NOT NULL,
  dataset_version_id text,
  baseline_batch_id text REFERENCES experiment_batches(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX experiment_batches_experiment_idx ON experiment_batches(experiment_id,created_at DESC);

CREATE TABLE experiment_runs (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES experiment_batches(id) ON DELETE CASCADE,
  experiment_id text NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant_id text NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  case_id text,
  input_index integer NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','completed','failed')),
  system_prompt text NOT NULL,
  user_prompt text NOT NULL,
  model_id text NOT NULL,
  api_model text NOT NULL,
  parameters jsonb NOT NULL,
  input_price numeric(14,6) NOT NULL,
  output_price numeric(14,6) NOT NULL,
  reserved_usd numeric(14,6) NOT NULL,
  output text,
  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  cost_usd numeric(14,6),
  auto_score numeric(5,3),
  score_reason text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE(batch_id,variant_id,input_index)
);
CREATE INDEX experiment_runs_queue_idx ON experiment_runs(status,created_at);
CREATE INDEX experiment_runs_experiment_idx ON experiment_runs(experiment_id,created_at DESC);
