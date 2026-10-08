CREATE TABLE evaluation_settings (
  id integer PRIMARY KEY CHECK(id=1),
  global_media_bytes bigint NOT NULL CHECK(global_media_bytes > 0),
  dataset_media_bytes bigint NOT NULL CHECK(dataset_media_bytes > 0),
  min_free_percent numeric(5,2) NOT NULL CHECK(min_free_percent >= 0 AND min_free_percent < 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(dataset_media_bytes <= global_media_bytes)
);
INSERT INTO evaluation_settings(id,global_media_bytes,dataset_media_bytes,min_free_percent)
VALUES(1,10737418240,5368709120,20);
