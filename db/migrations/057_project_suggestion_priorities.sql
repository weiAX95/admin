ALTER TABLE project_analysis_suggestions
  ADD COLUMN impact text CHECK (impact IN ('high','medium','low')),
  ADD COLUMN impact_reason text,
  ADD COLUMN prerequisites text[] NOT NULL DEFAULT '{}';
