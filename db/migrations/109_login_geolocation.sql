ALTER TABLE account_login_history
  ADD COLUMN geo_country text,
  ADD COLUMN geo_subdivision text,
  ADD COLUMN remote_device boolean NOT NULL DEFAULT false;
