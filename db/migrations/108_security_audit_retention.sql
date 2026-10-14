-- The runtime role may append audit events, but must not receive UPDATE or
-- DELETE on this table. Retention is the sole approved delete path.
CREATE FUNCTION cleanup_security_audit_logs() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE removed bigint;
BEGIN
  PERFORM set_config('app.audit_retention', 'on', true);
  DELETE FROM public.security_audit_logs
    WHERE created_at < now() - (
      SELECT audit_days * interval '1 day' FROM public.retention_settings WHERE id = 1
    );
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;

REVOKE ALL ON FUNCTION cleanup_security_audit_logs() FROM PUBLIC;
