ALTER TABLE alert_incidents ADD COLUMN escalated_at timestamptz;
CREATE INDEX alert_incidents_escalation_due_idx ON alert_incidents(opened_at)
  WHERE status='firing' AND level='warning' AND escalated_at IS NULL;
