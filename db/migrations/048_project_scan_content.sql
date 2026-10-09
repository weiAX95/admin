ALTER TABLE project_scan_files ADD COLUMN content text;
ALTER TABLE project_scan_files ADD CONSTRAINT project_scan_files_content_read_only CHECK (content IS NULL OR status = 'read');
