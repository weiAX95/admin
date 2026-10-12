CREATE TABLE session_usage_prices (
  session_id text NOT NULL,
  message_id text NOT NULL,
  model_id text REFERENCES experiment_models(id) ON DELETE SET NULL,
  input_price_snapshot numeric(14,6) CHECK (input_price_snapshot >= 0),
  output_price_snapshot numeric(14,6) CHECK (output_price_snapshot >= 0),
  priced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, message_id),
  FOREIGN KEY (session_id, message_id) REFERENCES session_messages(session_id, id) ON DELETE CASCADE,
  CONSTRAINT session_price_snapshot_complete CHECK ((input_price_snapshot IS NULL) = (output_price_snapshot IS NULL))
);

CREATE INDEX session_usage_prices_model_idx ON session_usage_prices(model_id);
