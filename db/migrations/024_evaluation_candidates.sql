CREATE TABLE evaluation_candidates (
  id text PRIMARY KEY,
  source_type text NOT NULL CHECK(source_type IN ('session','experiment')),
  source_annotation_id text NOT NULL,
  source_entity_id text NOT NULL,
  rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5),
  input_payload jsonb NOT NULL,
  expected_payload jsonb NOT NULL,
  context_payload jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','staged','rejected','ineligible','published')),
  target_dataset_id text REFERENCES experiment_datasets(id) ON DELETE SET NULL,
  published_version_id text REFERENCES experiment_dataset_versions(id) ON DELETE SET NULL,
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type,source_annotation_id)
);
CREATE INDEX evaluation_candidates_status_idx ON evaluation_candidates(status,created_at DESC);
