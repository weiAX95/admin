ALTER TABLE experiment_models DROP CONSTRAINT experiment_models_provider_check;
ALTER TABLE experiment_models ADD CONSTRAINT experiment_models_provider_check
  CHECK(provider IN ('legacy','openai','qwen','gemini','deepseek','anthropic','azure','local','custom'));

ALTER TABLE model_connections DROP CONSTRAINT model_connections_provider_check;
ALTER TABLE model_connections ADD CONSTRAINT model_connections_provider_check
  CHECK(provider IN ('legacy','openai','qwen','gemini','deepseek'));
