CREATE TABLE project_analysis_modules (
  analysis_id uuid NOT NULL REFERENCES project_analyses(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  indexed_count integer NOT NULL CHECK (indexed_count >= 0),
  read_count integer NOT NULL CHECK (read_count >= 0),
  selected_count integer NOT NULL CHECK (selected_count >= 0),
  truncated_count integer NOT NULL CHECK (truncated_count >= 0),
  excluded_count integer NOT NULL CHECK (excluded_count >= 0),
  failed_count integer NOT NULL CHECK (failed_count >= 0),
  unscanned_count integer NOT NULL CHECK (unscanned_count >= 0),
  PRIMARY KEY (analysis_id,module_key)
);
