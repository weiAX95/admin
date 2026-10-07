CREATE TABLE prompt_media_assets (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK(kind IN ('image','audio','video')),
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK(byte_size > 0),
  duration_seconds numeric(12,3),
  sha256 text NOT NULL,
  uploaded_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prompt_media_assets_hash_idx ON prompt_media_assets(sha256);

ALTER TABLE prompt_library_versions ADD COLUMN blocks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE experiment_models ADD COLUMN provider text NOT NULL DEFAULT 'legacy'
  CHECK(provider IN ('legacy','openai','qwen','gemini'));
ALTER TABLE experiment_models ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{"input":["text"],"output":["text"],"tools":false}'::jsonb;
ALTER TABLE experiment_models ADD COLUMN media_pricing jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE experiment_models DROP CONSTRAINT experiment_models_api_model_key;
ALTER TABLE experiment_models ADD CONSTRAINT experiment_models_provider_api_model_key UNIQUE(provider,api_model);

ALTER TABLE experiment_runs ADD COLUMN provider text NOT NULL DEFAULT 'legacy';
ALTER TABLE experiment_runs ADD COLUMN request_messages jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE experiment_runs ADD COLUMN tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE experiment_runs ADD COLUMN output_parts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE experiment_runs ADD COLUMN media_price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE experiment_runs ADD COLUMN media_usage jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE experiment_runs ADD COLUMN reserved_media_cost numeric(14,6) NOT NULL DEFAULT 0;
ALTER TABLE experiment_runs ADD COLUMN tools_schema jsonb;
ALTER TABLE experiment_runs ADD COLUMN judge_provider text NOT NULL DEFAULT 'legacy';
