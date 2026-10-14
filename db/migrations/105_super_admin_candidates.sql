ALTER TABLE users ADD COLUMN super_admin_candidate boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT users_super_admin_candidate_role CHECK (
  NOT super_admin_candidate OR role = 'admin'
);

COMMENT ON COLUMN users.super_admin_candidate IS
  'Nomination only; this account remains an Admin and never acquires SuperAdmin privileges automatically.';
