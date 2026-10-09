CREATE TABLE model_security_policies (
  model_id text PRIMARY KEY REFERENCES experiment_models(id) ON DELETE CASCADE,
  input_pii boolean NOT NULL DEFAULT false,
  input_jailbreak boolean NOT NULL DEFAULT false,
  output_pii boolean NOT NULL DEFAULT false,
  sensitive_words text[] NOT NULL DEFAULT '{}',
  brand_terms text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE model_security_events (
  id uuid PRIMARY KEY,
  model_id text NOT NULL,
  run_id text,
  phase text NOT NULL CHECK (phase IN ('main','judge')),
  direction text NOT NULL CHECK (direction IN ('input','output')),
  rule text NOT NULL CHECK (rule IN ('pii','jailbreak','sensitive_word','brand_risk')),
  action text NOT NULL CHECK (action IN ('blocked','replaced')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_security_events_time_idx ON model_security_events(created_at DESC);
