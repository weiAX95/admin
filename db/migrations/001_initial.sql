CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id text PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL, name text, role text NOT NULL, status text NOT NULL, created_at text, updated_at text);
CREATE TABLE auth_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);

CREATE TABLE tasks (id text PRIMARY KEY, title text NOT NULL, description text, category text, phase text, status text NOT NULL, priority text, due_date text, planned_start_date text, notes text, progress numeric, manual_progress numeric, estimated_hours numeric, owner_id text, version integer, active_cycle_started_at text, legacy_completion_unknown boolean, created_at text, updated_at text, recurring_series_id text, recurrence_index integer);
CREATE INDEX tasks_owner_idx ON tasks(owner_id);
CREATE INDEX tasks_recurring_idx ON tasks(recurring_series_id);
CREATE UNIQUE INDEX tasks_recurrence_unique ON tasks(recurring_series_id, recurrence_index) WHERE recurring_series_id IS NOT NULL;
CREATE TABLE task_checklist_items (task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, id text NOT NULL, text text NOT NULL, done boolean NOT NULL, item_order integer NOT NULL, PRIMARY KEY(task_id,id));
CREATE TABLE task_dependencies (task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, dependency_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, item_order integer NOT NULL, PRIMARY KEY(task_id,dependency_id));
CREATE TABLE task_tags (task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, tag text NOT NULL, item_order integer NOT NULL, PRIMARY KEY(task_id,tag));
CREATE TABLE task_resources (task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, item_order integer NOT NULL, label text NOT NULL, url text NOT NULL, PRIMARY KEY(task_id,item_order));
CREATE TABLE task_completion_cycles (task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, item_order integer NOT NULL, started_at text, completed_at text, PRIMARY KEY(task_id,item_order));

CREATE TABLE recurring_series (id text PRIMARY KEY, owner_id text, first_task_id text, frequency text NOT NULL, interval integer NOT NULL, end_type text NOT NULL, end_count integer, end_date text, anchor_due_at text NOT NULL, next_sequence integer NOT NULL, active boolean NOT NULL, version integer NOT NULL, created_at text, updated_at text, snapshot_title text, snapshot_description text, snapshot_category text, snapshot_phase text, snapshot_priority text, snapshot_estimated_hours numeric);
CREATE TABLE recurring_snapshot_checklist (series_id text NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE, item_order integer NOT NULL, text text NOT NULL, PRIMARY KEY(series_id,item_order));
CREATE TABLE recurring_snapshot_tags (series_id text NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE, item_order integer NOT NULL, tag text NOT NULL, PRIMARY KEY(series_id,item_order));
CREATE TABLE recurring_snapshot_resources (series_id text NOT NULL REFERENCES recurring_series(id) ON DELETE CASCADE, item_order integer NOT NULL, label text NOT NULL, url text NOT NULL, PRIMARY KEY(series_id,item_order));

CREATE TABLE task_templates (id text PRIMARY KEY, owner_id text, name text NOT NULL, description text, default_phase text, default_priority text);
CREATE TABLE template_checklist_items (template_id text NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE, item_order integer NOT NULL, text text NOT NULL, PRIMARY KEY(template_id,item_order));
CREATE TABLE template_resources (template_id text NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE, item_order integer NOT NULL, label text NOT NULL, url text NOT NULL, PRIMARY KEY(template_id,item_order));
CREATE TABLE time_entries (id text PRIMARY KEY, task_id text, recorded_by text, recorded_by_name text, mode text, work_date text, started_at text, ended_at text, duration_minutes integer, note text, created_at text, updated_at text);
CREATE INDEX time_entries_task_idx ON time_entries(task_id);
CREATE TABLE change_logs (id text PRIMARY KEY, operation_id text, task_id text, changed_by text, changed_by_name text, changed_at text, field_name text, old_value jsonb, new_value jsonb, action text, source_entry_id text);
CREATE INDEX change_logs_task_idx ON change_logs(task_id,changed_at);

CREATE TABLE sessions (id text PRIMARY KEY, external_user_id text NOT NULL, created_at text, updated_at text);
CREATE TABLE session_messages (session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, id text NOT NULL, role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL, at text NOT NULL, item_order integer NOT NULL, PRIMARY KEY(session_id,id));
CREATE INDEX session_messages_order_idx ON session_messages(session_id,item_order);
CREATE TABLE message_annotations (id text PRIMARY KEY, session_id text NOT NULL, message_id text NOT NULL, reviewer_id text REFERENCES users(id) ON DELETE SET NULL, rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5), created_at text NOT NULL, updated_at text NOT NULL, FOREIGN KEY (session_id,message_id) REFERENCES session_messages(session_id,id) ON DELETE CASCADE);
CREATE UNIQUE INDEX message_annotations_reviewer_unique ON message_annotations(session_id,message_id,reviewer_id) WHERE reviewer_id IS NOT NULL;
CREATE TABLE annotation_tags (annotation_id text NOT NULL REFERENCES message_annotations(id) ON DELETE CASCADE, tag text NOT NULL, PRIMARY KEY(annotation_id,tag));

CREATE TABLE notes (id text PRIMARY KEY, title text, content text, task_id text, source_session_id text, created_at text, updated_at text);
CREATE TABLE experiments (id text PRIMARY KEY, title text, task_id text, prompt text, model text, params text, result text, score numeric, created_at text, updated_at text);
CREATE TABLE activity (id text PRIMARY KEY, type text, task_id text, title text, detail text, at text, user_id text, username text, user_name text);
CREATE INDEX activity_at_idx ON activity(at DESC);
CREATE TABLE legacy_activity_ids (activity_id text PRIMARY KEY);
CREATE TABLE task_trend_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, type text, task_id text, at text);
CREATE TABLE task_trend_snapshots (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at text, total integer, progress_sum numeric);
CREATE TABLE data_imports (source_hash text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now());
