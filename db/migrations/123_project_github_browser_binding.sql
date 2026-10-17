-- Earlier pending states cannot be safely bound to a browser; they expire by design.
DELETE FROM project_github_oauth_states;
ALTER TABLE project_github_oauth_states
  ADD COLUMN browser_nonce_hash char(64) NOT NULL;
