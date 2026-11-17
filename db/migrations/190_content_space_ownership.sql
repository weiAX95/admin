-- Existing content stays in the legacy unassigned area until explicitly moved.
-- Final space deletion must explicitly deal with owned resources and their
-- external references; a cascade would silently remove historical evidence.
ALTER TABLE tasks ADD COLUMN space_id uuid REFERENCES collaboration_spaces(id) ON DELETE RESTRICT;
ALTER TABLE notes ADD COLUMN space_id uuid REFERENCES collaboration_spaces(id) ON DELETE RESTRICT;
ALTER TABLE experiments ADD COLUMN space_id uuid REFERENCES collaboration_spaces(id) ON DELETE RESTRICT;
ALTER TABLE prompt_library ADD COLUMN space_id uuid REFERENCES collaboration_spaces(id) ON DELETE RESTRICT;
ALTER TABLE experiment_datasets ADD COLUMN space_id uuid REFERENCES collaboration_spaces(id) ON DELETE RESTRICT;

CREATE INDEX tasks_space_idx ON tasks(space_id,id) WHERE deleted_at IS NULL;
CREATE INDEX notes_space_idx ON notes(space_id,id) WHERE deleted_at IS NULL;
CREATE INDEX experiments_space_idx ON experiments(space_id,id) WHERE deleted_at IS NULL;
CREATE INDEX prompt_library_space_idx ON prompt_library(space_id,id) WHERE deleted_at IS NULL;
CREATE INDEX experiment_datasets_space_idx ON experiment_datasets(space_id,id);
