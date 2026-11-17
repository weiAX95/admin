-- Space membership is explicit; the single owner is stored on the space row.
-- Existing content remains outside spaces until access checks and migration are ready.
CREATE TABLE collaboration_spaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'team',
  owner_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_spaces_owner_idx ON collaboration_spaces(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX collaboration_spaces_deleted_idx ON collaboration_spaces(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE collaboration_space_members (
  space_id uuid NOT NULL REFERENCES collaboration_spaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX collaboration_space_members_user_idx ON collaboration_space_members(user_id, space_id);
