ALTER TABLE project_repositories
  ADD COLUMN last_poll_at timestamptz,
  ADD COLUMN last_poll_error text CHECK (last_poll_error IS NULL OR char_length(last_poll_error) <= 80);
