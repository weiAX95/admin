ALTER TABLE outbound_webhook_events ADD COLUMN source_key text;
CREATE UNIQUE INDEX outbound_webhook_event_source_unique
  ON outbound_webhook_events(event_type,source_key) WHERE source_key IS NOT NULL;

CREATE FUNCTION enqueue_notification_alert_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  alert_key text;
  alert_data jsonb;
BEGIN
  IF NEW.kind NOT IN (
    'model-health','model_cost_budget','model_cost_anomaly','model_rate_near_limit','model_token_quota',
    'model_deprecated','model_retired','evaluation_schedule_failed','evaluation_dispute',
    'schedule_failed','schedule_paused'
  ) OR NOT EXISTS (SELECT 1 FROM outbound_webhooks WHERE event_type='alert.firing' AND enabled AND deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;

  -- Per-user quota alerts must remain distinct; the other kinds represent one shared incident.
  alert_key := NEW.kind || ':' || CASE WHEN NEW.kind='model_token_quota' THEN NEW.user_id || ':' ELSE '' END || NEW.entity_id;
  alert_data := jsonb_strip_nulls(jsonb_build_object(
    'sourceType','notification','alertKind',NEW.kind,'sourceEntityId',NEW.entity_id,
    'title',NEW.title,'body',NEW.body,'targetUrl',NEW.target_url,'createdAt',NEW.created_at,
    'userId',CASE WHEN NEW.kind='model_token_quota' THEN NEW.user_id ELSE NULL END
  ));
  INSERT INTO outbound_webhook_events(id,event_type,payload,source_key)
  VALUES(gen_random_uuid()::text,'alert.firing',alert_data,alert_key)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER outbound_notification_alert AFTER INSERT ON app_notifications
  FOR EACH ROW EXECUTE FUNCTION enqueue_notification_alert_webhook();
