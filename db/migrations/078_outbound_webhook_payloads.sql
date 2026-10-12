CREATE FUNCTION expand_outbound_webhook_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  extra jsonb := '{}'::jsonb;
BEGIN
  IF NEW.event_type = 'task.completed' THEN
    SELECT jsonb_build_object('description',t.description,'category',t.category,'phase',t.phase,
      'priority',t.priority,'dueDate',t.due_date,'plannedStartDate',t.planned_start_date,
      'progress',t.progress,'notes',t.notes,'ownerId',t.owner_id)
    INTO extra FROM tasks t WHERE t.id = NEW.payload->>'taskId';
  ELSIF NEW.event_type = 'note.updated' THEN
    SELECT jsonb_build_object('content',n.content,'taskId',n.task_id,'categoryId',n.category_id,
      'sourceSessionId',n.source_session_id)
    INTO extra FROM notes n WHERE n.id = NEW.payload->>'noteId';
  ELSIF NEW.event_type IN ('experiment.finished','evaluation.completed') THEN
    SELECT jsonb_build_object('runCount',count(*),'completedRuns',count(*) FILTER (WHERE r.status='completed'),
      'failedRuns',count(*) FILTER (WHERE r.status='failed'),
      'promptTokens',coalesce(sum(r.prompt_tokens),0),'completionTokens',coalesce(sum(r.completion_tokens),0),
      'costUsd',coalesce(sum(r.cost_usd),0))
    INTO extra FROM experiment_runs r WHERE r.batch_id=NEW.payload->>'batchId';
  ELSIF NEW.event_type = 'alert.firing' THEN
    SELECT jsonb_build_object('details',a.details,'baselineBatchId',a.baseline_batch_id,
      'metricVersionId',a.metric_version_id)
    INTO extra FROM evaluation_alerts a WHERE a.id=NEW.payload->>'alertId';
  END IF;
  IF extra IS NOT NULL AND extra <> '{}'::jsonb THEN
    UPDATE outbound_webhook_events SET payload=payload || extra WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbound_webhook_expand AFTER INSERT ON outbound_webhook_events
  FOR EACH ROW EXECUTE FUNCTION expand_outbound_webhook_event();
