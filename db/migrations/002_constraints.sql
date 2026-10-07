ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','member'));
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','disabled'));
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo','in_progress','done','blocked'));
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (priority IN ('low','medium','high'));
ALTER TABLE time_entries ADD CONSTRAINT time_entries_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE annotation_tags ADD CONSTRAINT annotation_tags_label_check CHECK (tag IN ('准确','不准确','偏题','幻觉','过于冗长','过于简略','格式错误'));
