CREATE TABLE project_github_oauth_states (
  state_hash char(64) PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_github_oauth_states_expiry_idx ON project_github_oauth_states(expires_at);

CREATE TABLE project_github_connections (
  owner_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  github_user_id bigint NOT NULL,
  github_login text NOT NULL,
  access_cipher bytea NOT NULL,
  access_nonce bytea NOT NULL,
  access_tag bytea NOT NULL,
  refresh_cipher bytea NOT NULL,
  refresh_nonce bytea NOT NULL,
  refresh_tag bytea NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  key_version text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
