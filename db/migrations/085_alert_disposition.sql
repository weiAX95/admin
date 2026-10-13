ALTER TABLE alert_incidents ADD COLUMN assigned_to text REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX alert_incidents_assignee_idx ON alert_incidents(assigned_to,opened_at DESC)
  WHERE assigned_to IS NOT NULL;

CREATE TABLE alert_incident_events (
  id text PRIMARY KEY,
  incident_id text NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK(event_type IN ('opened','escalated','acknowledged','assigned','note','resolved')),
  detail text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_incident_events_timeline_idx ON alert_incident_events(incident_id,occurred_at,id);

INSERT INTO alert_incident_events(id,incident_id,event_type,occurred_at)
SELECT gen_random_uuid()::text,id,'opened',opened_at FROM alert_incidents;
INSERT INTO alert_incident_events(id,incident_id,actor_id,event_type,occurred_at)
SELECT gen_random_uuid()::text,id,acknowledged_by,'acknowledged',acknowledged_at
FROM alert_incidents WHERE acknowledged_at IS NOT NULL;
INSERT INTO alert_incident_events(id,incident_id,event_type,detail,occurred_at)
SELECT gen_random_uuid()::text,id,'resolved',resolution_note,resolved_at
FROM alert_incidents WHERE resolved_at IS NOT NULL;
INSERT INTO alert_incident_events(id,incident_id,event_type,detail,occurred_at)
SELECT gen_random_uuid()::text,id,'escalated','30 分钟未确认，升级为 Critical',escalated_at
FROM alert_incidents WHERE escalated_at IS NOT NULL;
