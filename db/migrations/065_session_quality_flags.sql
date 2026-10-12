CREATE TABLE session_quality_flags (
  session_id text NOT NULL,
  message_id text NOT NULL,
  flag_type text NOT NULL CHECK (flag_type IN ('rejection', 'excessive_length')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, message_id, flag_type),
  FOREIGN KEY (session_id, message_id) REFERENCES session_messages(session_id, id) ON DELETE CASCADE
);

CREATE INDEX session_quality_flags_type_idx ON session_quality_flags(flag_type, session_id);

INSERT INTO session_quality_flags(session_id, message_id, flag_type)
SELECT session_id, id, 'rejection' FROM session_messages
WHERE role='assistant' AND content ~ '我无法|我不能|对不起.*无法';

INSERT INTO session_quality_flags(session_id, message_id, flag_type)
SELECT session_id, id, 'excessive_length' FROM session_messages
WHERE role='assistant' AND completion_tokens > 2000;
