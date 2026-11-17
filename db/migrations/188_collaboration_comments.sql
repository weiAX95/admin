-- Preserve task comments while extending the same thread model to the other
-- collaboration entities. Each comment belongs to exactly one typed parent.
ALTER TABLE task_comments RENAME TO collaboration_comments;
ALTER TABLE collaboration_comments ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE collaboration_comments ADD COLUMN note_id text REFERENCES notes(id) ON DELETE CASCADE;
ALTER TABLE collaboration_comments ADD COLUMN experiment_id text REFERENCES experiments(id) ON DELETE CASCADE;
ALTER TABLE collaboration_comments ADD COLUMN prompt_id text REFERENCES prompt_library(id) ON DELETE CASCADE;
ALTER TABLE collaboration_comments ADD COLUMN case_id text REFERENCES experiment_dataset_cases(id) ON DELETE CASCADE;
ALTER TABLE collaboration_comments ADD CONSTRAINT collaboration_comments_one_entity
  CHECK (num_nonnulls(task_id,note_id,experiment_id,prompt_id,case_id)=1);

-- Composite parent keys enforce that a reply remains on its parent's entity.
ALTER TABLE collaboration_comments ADD CONSTRAINT collaboration_comments_note_key UNIQUE(id,note_id);
ALTER TABLE collaboration_comments ADD CONSTRAINT collaboration_comments_experiment_key UNIQUE(id,experiment_id);
ALTER TABLE collaboration_comments ADD CONSTRAINT collaboration_comments_prompt_key UNIQUE(id,prompt_id);
ALTER TABLE collaboration_comments ADD CONSTRAINT collaboration_comments_case_key UNIQUE(id,case_id);
ALTER TABLE collaboration_comments ADD CONSTRAINT collaboration_comments_note_parent_fk
  FOREIGN KEY(parent_id,note_id) REFERENCES collaboration_comments(id,note_id) ON DELETE RESTRICT;
ALTER TABLE collaboration_comments ADD CONSTRAINT collaboration_comments_experiment_parent_fk
  FOREIGN KEY(parent_id,experiment_id) REFERENCES collaboration_comments(id,experiment_id) ON DELETE RESTRICT;
ALTER TABLE collaboration_comments ADD CONSTRAINT collaboration_comments_prompt_parent_fk
  FOREIGN KEY(parent_id,prompt_id) REFERENCES collaboration_comments(id,prompt_id) ON DELETE RESTRICT;
ALTER TABLE collaboration_comments ADD CONSTRAINT collaboration_comments_case_parent_fk
  FOREIGN KEY(parent_id,case_id) REFERENCES collaboration_comments(id,case_id) ON DELETE RESTRICT;
CREATE INDEX collaboration_comments_note_roots_idx ON collaboration_comments(note_id,created_at DESC,id) WHERE note_id IS NOT NULL AND parent_id IS NULL;
CREATE INDEX collaboration_comments_experiment_roots_idx ON collaboration_comments(experiment_id,created_at DESC,id) WHERE experiment_id IS NOT NULL AND parent_id IS NULL;
CREATE INDEX collaboration_comments_prompt_roots_idx ON collaboration_comments(prompt_id,created_at DESC,id) WHERE prompt_id IS NOT NULL AND parent_id IS NULL;
CREATE INDEX collaboration_comments_case_roots_idx ON collaboration_comments(case_id,created_at DESC,id) WHERE case_id IS NOT NULL AND parent_id IS NULL;
