CREATE TABLE password_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_history_recent_idx ON password_history(user_id, changed_at DESC, id DESC);

-- Imported accounts keep their current password as the first known history entry.
INSERT INTO password_history(user_id, password_hash, changed_at)
SELECT id, password_hash, COALESCE(NULLIF(updated_at, '')::timestamptz, now())
FROM users;
