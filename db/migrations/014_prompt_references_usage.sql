CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE prompt_version_includes (
  source_version_id text NOT NULL REFERENCES prompt_library_versions(id) ON DELETE CASCADE,
  target_version_id text NOT NULL REFERENCES prompt_library_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY(source_version_id,target_version_id),
  CHECK(source_version_id <> target_version_id)
);
CREATE INDEX prompt_version_includes_target_idx ON prompt_version_includes(target_version_id);
CREATE TABLE prompt_run_uses (
  run_id text NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  version_id text NOT NULL REFERENCES prompt_library_versions(id) ON DELETE RESTRICT,
  direct boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,version_id)
);
CREATE INDEX prompt_run_uses_version_idx ON prompt_run_uses(version_id,created_at DESC);
CREATE INDEX prompt_library_name_trgm ON prompt_library USING gin(name gin_trgm_ops);
CREATE INDEX prompt_library_versions_content_trgm ON prompt_library_versions USING gin(content gin_trgm_ops);
