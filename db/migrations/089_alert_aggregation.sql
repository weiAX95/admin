ALTER TABLE alert_rules ADD COLUMN aggregate_minutes integer NOT NULL DEFAULT 5
  CHECK(aggregate_minutes BETWEEN 1 AND 1440);

CREATE TABLE alert_incident_groups (
  id text PRIMARY KEY,
  rule_id text REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_name text NOT NULL,
  metric text NOT NULL,
  scope_id text NOT NULL,
  opened_at timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  latest_at timestamptz NOT NULL,
  incident_count integer NOT NULL DEFAULT 1 CHECK(incident_count > 0),
  CHECK(window_end > opened_at)
);
CREATE INDEX alert_incident_groups_lookup_idx
  ON alert_incident_groups(rule_id,scope_id,window_end DESC) WHERE rule_id IS NOT NULL;
CREATE INDEX alert_incident_groups_history_idx ON alert_incident_groups(opened_at DESC);

ALTER TABLE alert_incidents ADD COLUMN aggregate_group_id text REFERENCES alert_incident_groups(id) ON DELETE SET NULL;
CREATE INDEX alert_incidents_group_idx ON alert_incidents(aggregate_group_id,opened_at);

-- Existing incidents remain separate groups because their historical notification boundaries are unknown.
INSERT INTO alert_incident_groups(id,rule_id,rule_name,metric,scope_id,opened_at,window_end,latest_at)
SELECT id,rule_id,rule_name,metric,scope_id,opened_at,opened_at + interval '5 minutes',opened_at
FROM alert_incidents;
UPDATE alert_incidents SET aggregate_group_id=id WHERE aggregate_group_id IS NULL;
