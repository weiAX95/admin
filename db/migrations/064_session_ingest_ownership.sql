-- Legacy sessions have no trustworthy management-account owner. Admins may
-- continue their ingest; newly created sessions record the authenticated writer.
ALTER TABLE sessions ADD COLUMN ingested_by text REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX sessions_ingested_by_idx ON sessions(ingested_by) WHERE ingested_by IS NOT NULL;
