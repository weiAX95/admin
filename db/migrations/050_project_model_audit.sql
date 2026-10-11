ALTER TABLE model_call_audit DROP CONSTRAINT model_call_audit_module_check;
ALTER TABLE model_call_audit ADD CONSTRAINT model_call_audit_module_check CHECK (module IN ('experiments','evaluations','project_analysis'));
