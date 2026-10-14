-- TOTP is enabled only after the owner confirms a code from the pending secret.
-- A setup-only session may access the enrollment routes but no business API.
ALTER TABLE auth_sessions ADD COLUMN mfa_setup_required boolean NOT NULL DEFAULT false;

CREATE TABLE account_mfa (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted text,
  pending_secret_encrypted text,
  pending_attempts smallint NOT NULL DEFAULT 0 CHECK (pending_attempts BETWEEN 0 AND 5),
  enabled_at timestamptz,
  last_counter bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_mfa_enabled_secret_check CHECK ((enabled_at IS NULL) OR (secret_encrypted IS NOT NULL))
);

CREATE TABLE account_mfa_recovery_codes (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE account_mfa_login_challenges (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash text,
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_mfa_login_challenges_user_idx ON account_mfa_login_challenges(user_id, expires_at);

-- Admin+ cannot keep a business session without enrolling after this migration.
UPDATE auth_sessions SET mfa_setup_required=true
WHERE user_id IN (SELECT id FROM users WHERE role IN ('admin', 'super_admin')) AND revoked_at IS NULL;
