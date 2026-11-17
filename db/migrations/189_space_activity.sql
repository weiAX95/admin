-- Space management events are recorded synchronously with the operation.
-- Content events will use this stream after resources have a space owner.
CREATE TABLE collaboration_space_activity (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES collaboration_spaces(id) ON DELETE CASCADE,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  action text NOT NULL CHECK (action IN (
    'space.created','space.updated','space.archived','space.restored','space.deleted',
    'member.added','member.role_changed','member.removed','owner.transferred'
  )),
  resource_type text NOT NULL CHECK (resource_type IN ('space','member')),
  resource_id text,
  detail text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collaboration_space_activity_recent_idx
  ON collaboration_space_activity(space_id,occurred_at DESC,id DESC);
CREATE INDEX collaboration_space_activity_filter_idx
  ON collaboration_space_activity(space_id,action,actor_id,occurred_at DESC);
