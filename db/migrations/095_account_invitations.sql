ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','disabled','pending'));
ALTER TABLE users DROP CONSTRAINT users_status_before_delete_check;
ALTER TABLE users ADD CONSTRAINT users_status_before_delete_check CHECK (status_before_delete IN ('active','disabled','pending'));
ALTER TABLE users ADD COLUMN activation_mode text NOT NULL DEFAULT 'immediate' CHECK (activation_mode IN ('immediate','first_login','manual'));
ALTER TABLE users ADD COLUMN activated_at timestamptz;

CREATE TABLE account_invitations (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  username text NOT NULL,
  display_name text,
  role text NOT NULL CHECK (role IN ('admin','member')),
  activation_mode text NOT NULL CHECK (activation_mode IN ('immediate','first_login','manual')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_user_id text REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  CHECK (consumed_at IS NULL OR consumed_user_id IS NOT NULL)
);
CREATE INDEX account_invitations_created_idx ON account_invitations(created_at DESC);
CREATE INDEX account_invitations_username_idx ON account_invitations(username,expires_at DESC);
