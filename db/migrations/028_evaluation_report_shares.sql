CREATE TABLE evaluation_report_shares (
  id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES experiment_batches(id) ON DELETE CASCADE,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evaluation_report_shares_batch_idx ON evaluation_report_shares(batch_id,created_at DESC);
