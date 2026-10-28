ALTER TABLE project_analyses ADD COLUMN selected_file_paths text[];

ALTER TABLE project_analyses ADD CONSTRAINT project_analyses_selected_paths_count_check
  CHECK (selected_file_paths IS NULL OR cardinality(selected_file_paths) = selected_file_count);
