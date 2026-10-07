CREATE TABLE note_tag_definitions (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 1 AND 32 AND name = btrim(name)),
  normalized_key text NOT NULL UNIQUE,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK (normalized_key = translate(name, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
);

-- Backfill old text assignments. Pick a stable display spelling and collapse
-- case/edge-space duplicates before adding the catalog foreign key.
CREATE TEMP TABLE note_tag_names ON COMMIT DROP AS
SELECT DISTINCT ON (normalized_key)
  normalized_key, btrim(tag) AS name
FROM (
  SELECT tag, translate(btrim(tag), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') AS normalized_key
  FROM note_tags
) old_tags
ORDER BY normalized_key, btrim(tag) COLLATE "C";

INSERT INTO note_tag_definitions (id, name, normalized_key, created_at, updated_at)
SELECT gen_random_uuid()::text, name, normalized_key, now()::text, now()::text
FROM note_tag_names;

CREATE TEMP TABLE normalized_note_tags ON COMMIT DROP AS
SELECT note_tags.note_id, names.name AS tag, min(note_tags.item_order) AS item_order
FROM note_tags
JOIN note_tag_names names
  ON names.normalized_key = translate(btrim(note_tags.tag), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
GROUP BY note_tags.note_id, names.name;

DELETE FROM note_tags;
INSERT INTO note_tags (note_id, tag, item_order)
SELECT note_id, tag, item_order FROM normalized_note_tags;

ALTER TABLE note_tags ADD CONSTRAINT note_tags_definition_fk
  FOREIGN KEY (tag) REFERENCES note_tag_definitions(name)
  ON UPDATE CASCADE ON DELETE CASCADE;
