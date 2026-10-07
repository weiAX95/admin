CREATE TABLE note_links (
  source_note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  item_order integer NOT NULL,
  target_note_id text REFERENCES notes(id) ON DELETE SET NULL,
  target_ref text NOT NULL,
  label text NOT NULL,
  reason text,
  PRIMARY KEY (source_note_id, item_order)
);
CREATE INDEX note_links_target_idx ON note_links(target_note_id);
