ALTER TABLE experiment_batches DROP CONSTRAINT experiment_batches_kind_check;
ALTER TABLE experiment_batches ADD CONSTRAINT experiment_batches_kind_check
  CHECK(kind IN ('single','ab','dataset','regression','scheduled'));
