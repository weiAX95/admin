CREATE TABLE prompt_folders (
  id text PRIMARY KEY,
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  parent_id text REFERENCES prompt_folders(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(parent_id,name)
);
CREATE UNIQUE INDEX prompt_folders_root_name ON prompt_folders(name) WHERE parent_id IS NULL;

ALTER TABLE prompt_library ADD COLUMN folder_id text REFERENCES prompt_folders(id) ON DELETE RESTRICT;
ALTER TABLE prompt_library ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE prompt_library ADD COLUMN deleted_at timestamptz;
ALTER TABLE prompt_library ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX prompt_library_folder_idx ON prompt_library(folder_id) WHERE deleted_at IS NULL;
CREATE INDEX prompt_library_tags_idx ON prompt_library USING gin(tags);

ALTER TABLE prompt_library_versions ADD COLUMN semver text;
UPDATE prompt_library_versions SET semver='0.0.' || version;
ALTER TABLE prompt_library_versions ALTER COLUMN semver SET NOT NULL;
ALTER TABLE prompt_library_versions ADD CONSTRAINT prompt_versions_semver_format CHECK(semver ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$');
ALTER TABLE prompt_library_versions ADD CONSTRAINT prompt_versions_semver_unique UNIQUE(prompt_id,semver);
ALTER TABLE prompt_library_versions ADD COLUMN prompt_type text NOT NULL DEFAULT 'system' CHECK(prompt_type IN ('system','user','assistant','tool_description'));
ALTER TABLE prompt_library_versions ADD COLUMN format text NOT NULL DEFAULT 'text' CHECK(format IN ('text','chat','tool'));
ALTER TABLE prompt_library_versions ADD COLUMN variables jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE prompt_library_versions ADD COLUMN messages jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE prompt_library_versions ADD COLUMN tool_schema jsonb;
ALTER TABLE prompt_library_versions ADD COLUMN author_id text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE prompt_library_versions ADD COLUMN change_summary text NOT NULL DEFAULT '';
CREATE INDEX prompt_library_versions_latest_idx ON prompt_library_versions(prompt_id,version DESC);

CREATE TABLE prompt_compliance_rules (
  id text PRIMARY KEY,
  name text NOT NULL,
  pattern text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE prompt_compliance_events (
  id text PRIMARY KEY,
  prompt_id text REFERENCES prompt_library(id) ON DELETE SET NULL,
  version_id text REFERENCES prompt_library_versions(id) ON DELETE SET NULL,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  findings jsonb NOT NULL,
  action text NOT NULL CHECK(action IN ('confirmed','blocked','import_skipped')),
  created_at timestamptz NOT NULL DEFAULT now()
);
