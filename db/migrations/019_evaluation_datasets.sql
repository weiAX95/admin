CREATE TABLE evaluation_folders (
  id text PRIMARY KEY,
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  parent_id text REFERENCES evaluation_folders(id) ON DELETE RESTRICT,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(id <> parent_id)
);
CREATE INDEX evaluation_folders_parent_idx ON evaluation_folders(parent_id);
ALTER TABLE experiment_datasets ADD COLUMN folder_id text REFERENCES evaluation_folders(id) ON DELETE SET NULL;
ALTER TABLE experiment_datasets ADD COLUMN parent_version_id text REFERENCES experiment_dataset_versions(id) ON DELETE SET NULL;
ALTER TABLE experiment_dataset_cases ADD COLUMN input_payload jsonb;
ALTER TABLE experiment_dataset_cases ADD COLUMN expected_payload jsonb;
ALTER TABLE experiment_dataset_cases ADD COLUMN context_payload jsonb NOT NULL DEFAULT '[]';
ALTER TABLE experiment_dataset_cases ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE experiment_dataset_cases ADD COLUMN difficulty_score smallint CHECK(difficulty_score BETWEEN 1 AND 5);
ALTER TABLE experiment_dataset_cases ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','session_extract','qa_import'));
ALTER TABLE experiment_dataset_cases ADD COLUMN expected_tools jsonb;
CREATE INDEX experiment_dataset_cases_tags_idx ON experiment_dataset_cases USING gin(tags);
CREATE INDEX experiment_dataset_cases_key_idx ON experiment_dataset_cases(case_key);
CREATE TABLE evaluation_case_assets (
  case_id text NOT NULL REFERENCES experiment_dataset_cases(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES prompt_media_assets(id) ON DELETE RESTRICT,
  PRIMARY KEY(case_id,asset_id)
);
CREATE INDEX evaluation_case_assets_asset_idx ON evaluation_case_assets(asset_id);
