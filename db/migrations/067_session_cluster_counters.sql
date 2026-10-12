ALTER TABLE session_cluster_settings
  ADD COLUMN document_count integer NOT NULL DEFAULT 0 CHECK (document_count >= 0),
  ADD COLUMN target_k integer NOT NULL DEFAULT 0 CHECK (target_k >= 0);
