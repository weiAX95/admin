ALTER TABLE experiment_metric_versions DROP CONSTRAINT experiment_metric_versions_rule_type_check;
ALTER TABLE experiment_metric_versions ADD CONSTRAINT experiment_metric_versions_rule_type_check CHECK(rule_type IN ('token_f1','exact','bleu','rouge_l','tool_selection','parameter_accuracy','bertscore'));
ALTER TABLE experiment_metric_versions ADD COLUMN tokenizer_version text NOT NULL DEFAULT 'intl-word-v1';
ALTER TABLE experiment_metric_versions ADD COLUMN goal_min numeric(12,4) NOT NULL DEFAULT 0;
ALTER TABLE experiment_metric_versions ADD COLUMN goal_max numeric(12,4) NOT NULL DEFAULT 5;
ALTER TABLE experiment_metric_versions ADD COLUMN higher_is_better boolean NOT NULL DEFAULT true;
ALTER TABLE experiment_metric_versions ADD CONSTRAINT experiment_metric_goal_range CHECK(goal_max > goal_min);
