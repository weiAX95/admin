ALTER TABLE session_messages
  ADD COLUMN prompt_tokens integer CHECK (prompt_tokens >= 0),
  ADD COLUMN completion_tokens integer CHECK (completion_tokens >= 0),
  ADD COLUMN usage_model text,
  ADD CONSTRAINT session_message_usage_complete CHECK ((prompt_tokens IS NULL) = (completion_tokens IS NULL)),
  ADD CONSTRAINT session_message_usage_assistant CHECK (prompt_tokens IS NULL OR role = 'assistant'),
  ADD CONSTRAINT session_message_usage_model CHECK (usage_model IS NULL OR (prompt_tokens IS NOT NULL AND length(usage_model) BETWEEN 1 AND 120));

CREATE INDEX session_messages_usage_at_idx ON session_messages(at) WHERE prompt_tokens IS NOT NULL;
