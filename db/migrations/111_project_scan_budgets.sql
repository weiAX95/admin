ALTER TABLE project_scans
  ADD COLUMN budget_file_limit integer NOT NULL DEFAULT 200
    CHECK (budget_file_limit IN (50, 100, 200, 500)),
  ADD COLUMN budget_byte_limit integer NOT NULL DEFAULT 5242880
    CHECK (budget_byte_limit IN (1048576, 5242880, 10485760));
