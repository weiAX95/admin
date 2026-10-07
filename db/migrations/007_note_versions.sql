CREATE TABLE note_versions (
  id text PRIMARY KEY,
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  title text NOT NULL,
  content text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('baseline', 'save', 'restore')),
  created_at text NOT NULL,
  UNIQUE (note_id, version_number)
);
CREATE INDEX note_versions_timeline_idx ON note_versions(note_id, version_number DESC);

-- Existing notes have no reconstructable past. Their current values become
-- version 1; no older versions are invented.
INSERT INTO note_versions(id, note_id, version_number, title, content, reason, created_at)
SELECT gen_random_uuid()::text, id, 1, coalesce(title, ''), coalesce(content, ''), 'baseline', coalesce(updated_at, now()::text)
FROM notes;
