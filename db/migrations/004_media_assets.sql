CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_created_idx ON media_assets(created_at);
