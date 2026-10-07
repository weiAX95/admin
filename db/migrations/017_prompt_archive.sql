CREATE TABLE prompt_import_assets (
  source_key text NOT NULL,
  source_asset_id text NOT NULL,
  asset_id text NOT NULL REFERENCES prompt_media_assets(id) ON DELETE RESTRICT,
  sha256 text NOT NULL,
  PRIMARY KEY (source_key, source_asset_id)
);
