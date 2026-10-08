ALTER TABLE experiment_runs
  ADD COLUMN judge_media_price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
