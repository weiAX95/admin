ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'member'));

-- Existing installations keep the oldest active administrator as their sole owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin') THEN
    UPDATE users SET role = 'super_admin', updated_at = now()::text
    WHERE id = (
      SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL
      ORDER BY created_at NULLS LAST, id LIMIT 1
    );
    IF EXISTS (SELECT 1 FROM users) AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin') THEN
      RAISE EXCEPTION 'Cannot install SuperAdmin role without an active administrator';
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX users_single_super_admin ON users (role) WHERE role = 'super_admin';
ALTER TABLE users ADD CONSTRAINT users_super_admin_active CHECK (
  role <> 'super_admin' OR (status = 'active' AND deleted_at IS NULL)
);

CREATE FUNCTION protect_super_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_admin' THEN
      RAISE EXCEPTION 'The SuperAdmin account cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.role = 'super_admin' AND
     (NEW.role <> 'super_admin' OR NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'The SuperAdmin account cannot be demoted or disabled';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER users_protect_super_admin
BEFORE UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION protect_super_admin();
