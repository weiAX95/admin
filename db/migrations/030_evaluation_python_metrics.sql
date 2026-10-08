CREATE TABLE evaluation_metric_scripts (
  id text PRIMARY KEY,
  name text NOT NULL,
  source text NOT NULL CHECK(length(source) BETWEEN 1 AND 20000),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE experiment_metric_versions DROP CONSTRAINT experiment_metric_versions_rule_type_check;
ALTER TABLE experiment_metric_versions ADD CONSTRAINT experiment_metric_versions_rule_type_check CHECK(rule_type IN ('token_f1','exact','bleu','rouge_l','tool_selection','parameter_accuracy','bertscore','custom_python'));
ALTER TABLE experiment_metric_versions ADD COLUMN custom_script_id text REFERENCES evaluation_metric_scripts(id) ON DELETE RESTRICT;
ALTER TABLE experiment_metric_versions ADD CONSTRAINT experiment_metric_custom_script_check CHECK((rule_type='custom_python')=(custom_script_id IS NOT NULL));
