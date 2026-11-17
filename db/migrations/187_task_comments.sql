-- First collaboration comment slice: task-scoped threads. Other entity types
-- are added only after their read permissions are enforced in the same API.
CREATE TABLE task_comments (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_id uuid,
  author_id text REFERENCES users(id) ON DELETE SET NULL,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 10000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, task_id),
  CONSTRAINT task_comments_parent_fk FOREIGN KEY (parent_id, task_id)
    REFERENCES task_comments(id, task_id) ON DELETE RESTRICT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX task_comments_roots_idx ON task_comments(task_id, created_at DESC, id) WHERE parent_id IS NULL;
CREATE INDEX task_comments_replies_idx ON task_comments(parent_id, created_at, id) WHERE parent_id IS NOT NULL;
