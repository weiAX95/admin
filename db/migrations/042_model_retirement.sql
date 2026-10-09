ALTER TABLE experiment_models ADD COLUMN deprecated_at timestamptz;
ALTER TABLE experiment_models ADD COLUMN retire_at timestamptz;
ALTER TABLE experiment_models ADD COLUMN retired_at timestamptz;
UPDATE experiment_models SET deprecated_at=now(),retire_at=now()+interval '7 days' WHERE status='deprecated';
UPDATE experiment_models SET retired_at=now() WHERE status='retired';
CREATE INDEX experiment_models_retire_due_idx ON experiment_models(retire_at) WHERE status='deprecated';
