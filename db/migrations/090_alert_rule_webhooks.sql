ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_channels_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_channels_check
  CHECK(channels <@ ARRAY['in_app','email','webhook']::text[]);

CREATE TABLE alert_rule_webhooks (
  rule_id text NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  webhook_id text NOT NULL REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
  PRIMARY KEY(rule_id,webhook_id)
);
CREATE INDEX alert_rule_webhooks_hook_idx ON alert_rule_webhooks(webhook_id);

ALTER TABLE app_notifications ADD COLUMN show_in_app boolean NOT NULL DEFAULT true;
