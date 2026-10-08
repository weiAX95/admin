CREATE TABLE model_connections (
  id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('legacy','openai','qwen','gemini')),
  name text NOT NULL,
  base_url text,
  key_cipher bytea NOT NULL,
  key_nonce bytea NOT NULL,
  key_tag bytea NOT NULL,
  key_version text NOT NULL,
  key_mask text NOT NULL,
  headers_cipher bytea,
  headers_nonce bytea,
  headers_tag bytea,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX model_connections_default_idx ON model_connections(provider) WHERE is_default AND active;
ALTER TABLE experiment_models ADD COLUMN connection_id text REFERENCES model_connections(id);
ALTER TABLE experiment_runs ADD COLUMN connection_id text REFERENCES model_connections(id);
ALTER TABLE experiment_runs ADD COLUMN judge_connection_id text REFERENCES model_connections(id);
CREATE TABLE security_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_audit_logs_created_idx ON security_audit_logs(created_at);
