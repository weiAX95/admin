ALTER TABLE experiment_run_metrics ADD COLUMN metric_details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE experiment_runs ADD COLUMN retry_limit integer NOT NULL DEFAULT 0 CHECK(retry_limit BETWEEN 0 AND 3);
CREATE INDEX experiment_batches_dataset_metric_idx ON experiment_batches(dataset_version_id,metric_version_id,created_at DESC);
