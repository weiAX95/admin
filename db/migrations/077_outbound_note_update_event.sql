DROP TRIGGER outbound_note_updated ON notes;
CREATE FUNCTION enqueue_outbound_note_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND OLD.updated_at IS DISTINCT FROM NEW.updated_at
     AND EXISTS (SELECT 1 FROM outbound_webhooks WHERE event_type='note.updated' AND enabled AND deleted_at IS NULL) THEN
    INSERT INTO outbound_webhook_events(id,event_type,payload)
    VALUES(gen_random_uuid()::text,'note.updated',jsonb_build_object('noteId',NEW.id,'title',NEW.title,'updatedAt',NEW.updated_at));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbound_note_updated AFTER UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION enqueue_outbound_note_update();
