ALTER TABLE alert_rules ADD COLUMN tags text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE TABLE alert_silences (
  id text PRIMARY KEY,
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  scope_type text NOT NULL CHECK(scope_type IN ('all','module','tag')),
  scope_value text,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  start_minute integer NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
  end_minute integer NOT NULL CHECK(end_minute BETWEEN 0 AND 1439),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(start_minute <> end_minute),
  CHECK((scope_type='all')=(scope_value IS NULL))
);
