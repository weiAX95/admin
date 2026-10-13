CREATE TABLE client_error_reports (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 256),
  error_name text NOT NULL CHECK (char_length(error_name) BETWEEN 1 AND 64),
  components text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_error_reports_user_recent_idx ON client_error_reports(user_id, created_at DESC);
CREATE INDEX client_error_reports_created_idx ON client_error_reports(created_at);
