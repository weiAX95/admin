ALTER TABLE project_repositories
  ADD COLUMN is_private boolean NOT NULL DEFAULT false;
CREATE INDEX project_repositories_private_owner_idx ON project_repositories(owner_id,is_private) WHERE is_private=true;
