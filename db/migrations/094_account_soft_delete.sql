ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ADD COLUMN status_before_delete text CHECK (status_before_delete IN ('active','disabled'));
CREATE INDEX users_deleted_at_idx ON users(deleted_at) WHERE deleted_at IS NOT NULL;
