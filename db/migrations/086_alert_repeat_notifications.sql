ALTER TABLE alert_rules ADD COLUMN repeat_minutes integer NOT NULL DEFAULT 30
  CHECK(repeat_minutes BETWEEN 1 AND 1440);
ALTER TABLE alert_incidents ADD COLUMN last_reminded_at timestamptz;
ALTER TABLE alert_incident_events DROP CONSTRAINT alert_incident_events_event_type_check;
ALTER TABLE alert_incident_events ADD CONSTRAINT alert_incident_events_event_type_check
  CHECK(event_type IN ('opened','escalated','acknowledged','assigned','note','resolved','reminded'));
CREATE INDEX alert_incidents_reminder_due_idx ON alert_incidents(opened_at,last_reminded_at)
  WHERE status='firing' AND level <> 'info';
