ALTER TABLE users ADD COLUMN max_devices integer NOT NULL DEFAULT 3 CHECK (max_devices BETWEEN 1 AND 10);
ALTER TABLE auth_sessions ADD COLUMN device_hash text;
CREATE INDEX auth_sessions_device_idx ON auth_sessions(user_id, device_hash, created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE account_login_history (
  id uuid PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  username text NOT NULL,
  ip_address text NOT NULL,
  user_agent text NOT NULL,
  device_hash text,
  succeeded boolean NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_login_history_user_idx ON account_login_history(user_id, created_at DESC);
CREATE INDEX account_login_history_created_idx ON account_login_history(created_at);
