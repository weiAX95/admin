CREATE TABLE prompt_import_sources (
  source_key text NOT NULL,
  source_prompt_id text NOT NULL,
  prompt_id text NOT NULL REFERENCES prompt_library(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_key,source_prompt_id),
  UNIQUE(source_key,prompt_id)
);
CREATE TABLE prompt_import_versions (
  source_key text NOT NULL,
  source_version_id text NOT NULL,
  version_id text NOT NULL REFERENCES prompt_library_versions(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_key,source_version_id),
  UNIQUE(source_key,version_id)
);
