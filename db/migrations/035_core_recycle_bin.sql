ALTER TABLE tasks ADD COLUMN deleted_at timestamptz;
ALTER TABLE notes ADD COLUMN deleted_at timestamptz;
ALTER TABLE experiments ADD COLUMN deleted_at timestamptz;
CREATE INDEX tasks_recycle_idx ON tasks(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX notes_recycle_idx ON notes(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX experiments_recycle_idx ON experiments(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX prompt_library_recycle_idx ON prompt_library(deleted_at) WHERE deleted_at IS NOT NULL;
ALTER TABLE retention_cleanup_runs ADD COLUMN purge_failures jsonb NOT NULL DEFAULT '[]'::jsonb;
