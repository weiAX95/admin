ALTER TABLE project_suggestion_decisions
  ADD COLUMN target_mode text CHECK (target_mode IN ('created','existing'));

UPDATE project_suggestion_decisions SET target_mode='created' WHERE state='accepted';

ALTER TABLE project_suggestion_decisions
  ADD CONSTRAINT project_suggestion_decisions_state_mode_check
  CHECK ((state='ignored' AND target_mode IS NULL) OR (state='accepted' AND target_mode IS NOT NULL));
