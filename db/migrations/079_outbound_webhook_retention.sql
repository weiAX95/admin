ALTER TABLE retention_cleanup_runs ADD COLUMN webhook_events_deleted integer NOT NULL DEFAULT 0;
