CREATE TABLE note_categories (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  parent_id text REFERENCES note_categories(id) ON DELETE RESTRICT,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX note_categories_sibling_name_unique ON note_categories ((coalesce(parent_id, '')), (lower(name)));
ALTER TABLE notes ADD COLUMN category_id text REFERENCES note_categories(id) ON DELETE SET NULL;
CREATE INDEX notes_category_idx ON notes(category_id);
CREATE TABLE note_tags (
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (length(trim(tag)) BETWEEN 1 AND 32),
  item_order integer NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX note_tags_tag_idx ON note_tags(tag);
