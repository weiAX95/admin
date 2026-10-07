ALTER TABLE users ADD COLUMN review_email text;
ALTER TABLE users ADD COLUMN review_email_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE note_review_progress (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  step integer NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 5),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  started_on date NOT NULL,
  due_on date NOT NULL,
  last_reviewed_at timestamptz,
  PRIMARY KEY (user_id, note_id)
);
CREATE INDEX note_review_due_idx ON note_review_progress(due_on);

CREATE TABLE note_review_events (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  reviewed_at timestamptz NOT NULL,
  UNIQUE (user_id, note_id, generation)
);

CREATE TABLE note_review_notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  due_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  email_status text NOT NULL DEFAULT 'skipped' CHECK (email_status IN ('skipped','pending','sending','sent','failed')),
  email_attempts integer NOT NULL DEFAULT 0,
  email_claimed_at timestamptz,
  email_next_attempt_at timestamptz,
  email_error text,
  email_to text,
  UNIQUE (user_id, note_id, generation)
);
CREATE INDEX note_review_notification_user_idx ON note_review_notifications(user_id, created_at DESC);
CREATE INDEX note_review_email_idx ON note_review_notifications(email_next_attempt_at) WHERE email_status IN ('pending','failed');

-- Existing notes begin a fresh cycle on the migration day in Shanghai.
INSERT INTO note_review_progress(user_id,note_id,started_on,due_on)
SELECT u.id,n.id,(now() AT TIME ZONE 'Asia/Shanghai')::date,
       (now() AT TIME ZONE 'Asia/Shanghai')::date + 1
FROM users u CROSS JOIN notes n;
