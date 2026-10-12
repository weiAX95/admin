CREATE TABLE session_cluster_settings (
  id integer PRIMARY KEY CHECK (id=1),
  requested_k integer CHECK (requested_k BETWEEN 1 AND 20),
  idf jsonb NOT NULL DEFAULT '{}'::jsonb,
  algorithm_version text NOT NULL DEFAULT 'tfidf-kmeans-v1',
  last_built_at timestamptz
);
INSERT INTO session_cluster_settings(id) VALUES(1);

CREATE TABLE session_clusters (
  id text PRIMARY KEY,
  label text NOT NULL,
  auto_label text NOT NULL,
  manually_labeled boolean NOT NULL DEFAULT false,
  centroid jsonb NOT NULL,
  member_count integer NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions ADD COLUMN cluster_id text REFERENCES session_clusters(id) ON DELETE SET NULL;
CREATE INDEX sessions_cluster_id_idx ON sessions(cluster_id);
