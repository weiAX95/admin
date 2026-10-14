ALTER TABLE users ADD COLUMN last_login_at timestamptz;
ALTER TABLE users ADD COLUMN inactive_since timestamptz;
UPDATE users u SET last_login_at = history.last_login_at FROM (
  SELECT user_id, MAX(created_at) AS last_login_at FROM account_login_history
  WHERE succeeded = true AND user_id IS NOT NULL GROUP BY user_id
) history WHERE u.id = history.user_id;

CREATE TABLE account_page_views (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  module text NOT NULL,
  view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_view_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date, module)
);
CREATE INDEX account_page_views_date_idx ON account_page_views(local_date, user_id);
