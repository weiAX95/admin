-- Legacy notes have no reliable creator. Keep them readable, but only Admin+
-- may change them. New notes are assigned to the authenticated creator.
ALTER TABLE notes ADD COLUMN owner_id text REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX notes_owner_id_idx ON notes(owner_id);
