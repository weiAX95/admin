INSERT INTO evaluation_candidates(id,source_type,source_annotation_id,source_entity_id,rating,input_payload,expected_payload,context_payload,status)
SELECT 'experiment-' || a.id,'experiment',a.id,r.id,a.rating,to_jsonb(r.user_prompt),
  CASE WHEN jsonb_array_length(r.output_parts) > 0 THEN jsonb_build_object('parts',r.output_parts) ELSE to_jsonb(COALESCE(r.output,'')) END,
  '[]'::jsonb,'pending'
FROM experiment_annotations a JOIN experiment_runs r ON r.id=a.run_id
WHERE a.rating >= 4 AND r.status='completed'
ON CONFLICT(source_type,source_annotation_id) DO NOTHING;

INSERT INTO evaluation_candidates(id,source_type,source_annotation_id,source_entity_id,rating,input_payload,expected_payload,context_payload,status)
SELECT 'session-' || a.id,'session',a.id,a.session_id || ':' || a.message_id,a.rating,to_jsonb(question.content),to_jsonb(answer.content),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('role',prior.role,'parts',jsonb_build_array(jsonb_build_object('type','text','text',prior.content))) ORDER BY prior.item_order)
    FROM session_messages prior WHERE prior.session_id=a.session_id AND prior.item_order<question.item_order),'[]'::jsonb),'pending'
FROM message_annotations a JOIN session_messages answer ON answer.session_id=a.session_id AND answer.id=a.message_id AND answer.role='assistant'
JOIN LATERAL (SELECT content,item_order FROM session_messages previous WHERE previous.session_id=a.session_id AND previous.role='user' AND previous.item_order<answer.item_order ORDER BY previous.item_order DESC LIMIT 1) question ON true
WHERE a.rating >= 4
ON CONFLICT(source_type,source_annotation_id) DO NOTHING;
