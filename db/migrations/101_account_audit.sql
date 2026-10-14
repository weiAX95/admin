ALTER TABLE security_audit_logs DROP CONSTRAINT security_audit_logs_actor_id_fkey;
CREATE INDEX security_audit_logs_actor_idx ON security_audit_logs(actor_id, created_at DESC);
CREATE INDEX security_audit_logs_action_idx ON security_audit_logs(action, created_at DESC);

CREATE FUNCTION reject_security_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.audit_retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'security_audit_logs is append-only';
END $$;
CREATE TRIGGER security_audit_immutable BEFORE UPDATE OR DELETE ON security_audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_security_audit_change();

CREATE FUNCTION audit_account_login() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO security_audit_logs(actor_id, action, target_type, target_id, details, created_at)
  VALUES (NEW.user_id, CASE WHEN NEW.succeeded THEN 'login_success' ELSE 'login_failure' END,
    'account', NEW.user_id,
    jsonb_build_object('username', NEW.username, 'ipAddress', NEW.ip_address,
      'userAgent', NEW.user_agent, 'reason', NEW.reason), NEW.created_at);
  RETURN NEW;
END $$;
CREATE TRIGGER account_login_audit AFTER INSERT ON account_login_history
  FOR EACH ROW EXECUTE FUNCTION audit_account_login();
