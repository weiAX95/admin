ALTER TABLE project_analyses
  ADD COLUMN token_budget integer
    CHECK (token_budget IN (30000, 60000, 120000)),
  ADD COLUMN cost_budget_usd numeric(14,6)
    CHECK (cost_budget_usd IN (0.10, 0.50, 1.00, 5.00));
