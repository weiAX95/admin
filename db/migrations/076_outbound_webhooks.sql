CREATE TABLE outbound_webhooks (
  id text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('task.completed','experiment.finished','evaluation.completed','alert.firing','note.updated')),
  target_url text NOT NULL,
  secret_cipher bytea NOT NULL,
  secret_nonce bytea NOT NULL,
  secret_tag bytea NOT NULL,
  headers_cipher bytea,
  headers_nonce bytea,
  headers_tag bytea,
  key_version text NOT NULL,
  secret_mask text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbound_webhooks_event_idx ON outbound_webhooks(event_type) WHERE enabled AND deleted_at IS NULL;

CREATE TABLE outbound_webhook_events (
  id text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('task.completed','experiment.finished','evaluation.completed','alert.firing','note.updated')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  fanned_out boolean NOT NULL DEFAULT false
);
CREATE INDEX outbound_webhook_events_pending_idx ON outbound_webhook_events(created_at) WHERE NOT fanned_out;

CREATE TABLE outbound_webhook_deliveries (
  id text PRIMARY KEY,
  webhook_id text NOT NULL REFERENCES outbound_webhooks(id),
  event_id text NOT NULL REFERENCES outbound_webhook_events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','delivered','failed','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 4),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(webhook_id,event_id)
);
CREATE INDEX outbound_webhook_deliveries_due_idx ON outbound_webhook_deliveries(next_attempt_at) WHERE status IN ('pending','sending');

CREATE TABLE outbound_webhook_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id text NOT NULL REFERENCES outbound_webhook_deliveries(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 4),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  status_code integer,
  response_body text,
  error text,
  UNIQUE(delivery_id,attempt_number)
);

CREATE FUNCTION enqueue_outbound_webhook_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kind text;
  details jsonb;
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'done' AND NEW.deleted_at IS NULL THEN
      kind := 'task.completed';
      details := jsonb_build_object('taskId',NEW.id,'title',NEW.title,'status',NEW.status,'completedAt',NEW.updated_at);
    END IF;
  ELSIF TG_TABLE_NAME = 'notes' THEN
    IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NULL AND (OLD.title IS DISTINCT FROM NEW.title OR OLD.content IS DISTINCT FROM NEW.content) THEN
      kind := 'note.updated';
      details := jsonb_build_object('noteId',NEW.id,'title',NEW.title,'updatedAt',NEW.updated_at);
    END IF;
  ELSIF TG_TABLE_NAME = 'experiment_batches' THEN
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed','partial','failed') THEN
      kind := CASE WHEN NEW.kind IN ('dataset','regression') THEN 'evaluation.completed' ELSE 'experiment.finished' END;
      details := jsonb_build_object('batchId',NEW.id,'experimentId',NEW.experiment_id,'status',NEW.status,'kind',NEW.kind,'completedAt',NEW.completed_at);
    END IF;
  ELSIF TG_TABLE_NAME = 'evaluation_alerts' AND TG_OP = 'INSERT' THEN
    kind := 'alert.firing';
    details := jsonb_build_object('alertId',NEW.id,'batchId',NEW.batch_id,'affectedCount',NEW.affected_count,'createdAt',NEW.created_at);
  END IF;
  IF kind IS NOT NULL AND EXISTS (SELECT 1 FROM outbound_webhooks WHERE event_type=kind AND enabled AND deleted_at IS NULL) THEN
    INSERT INTO outbound_webhook_events(id,event_type,payload)
    VALUES(gen_random_uuid()::text,kind,details);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER outbound_task_completed AFTER UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION enqueue_outbound_webhook_event();
CREATE TRIGGER outbound_note_updated AFTER UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION enqueue_outbound_webhook_event();
CREATE TRIGGER outbound_experiment_finished AFTER UPDATE ON experiment_batches FOR EACH ROW EXECUTE FUNCTION enqueue_outbound_webhook_event();
CREATE TRIGGER outbound_evaluation_alert AFTER INSERT ON evaluation_alerts FOR EACH ROW EXECUTE FUNCTION enqueue_outbound_webhook_event();
