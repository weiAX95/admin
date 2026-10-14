ALTER TABLE users ADD COLUMN ip_allowlist text[] NOT NULL DEFAULT '{}';
