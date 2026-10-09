CREATE TABLE model_cost_settings (
  id integer PRIMARY KEY CHECK(id=1),
  monthly_budget_usd numeric(18,6) NOT NULL DEFAULT 0 CHECK(monthly_budget_usd>=0),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO model_cost_settings(id) VALUES(1);
