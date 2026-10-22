-- A report's prerequisite text is immutable, but its relationship to the
-- owner's learning tasks can be corrected without changing the model report.
CREATE TABLE project_prerequisite_task_links (
  suggestion_id uuid NOT NULL,
  prerequisite_index integer NOT NULL CHECK (prerequisite_index BETWEEN 0 AND 4),
  analysis_id uuid NOT NULL,
  repository_id uuid NOT NULL,
  owner_id text NOT NULL,
  task_id text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (suggestion_id, prerequisite_index),
  FOREIGN KEY (suggestion_id, analysis_id)
    REFERENCES project_analysis_suggestions(id, analysis_id) ON DELETE CASCADE,
  FOREIGN KEY (analysis_id, repository_id, owner_id)
    REFERENCES project_analyses(id, repository_id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id, task_id)
    REFERENCES project_repository_tasks(repository_id, task_id) ON DELETE SET NULL (task_id)
);

CREATE INDEX project_prerequisite_task_links_analysis_idx
  ON project_prerequisite_task_links(analysis_id, owner_id);

-- A task being unlinked clears its mapping through the FK action. Advance the
-- version in that case too, so an old editor cannot silently replace it.
CREATE FUNCTION project_prerequisite_task_links_bump_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.task_id IS DISTINCT FROM OLD.task_id AND NEW.version <= OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_prerequisite_task_links_version_trigger
  BEFORE UPDATE OF task_id ON project_prerequisite_task_links
  FOR EACH ROW EXECUTE FUNCTION project_prerequisite_task_links_bump_version();
