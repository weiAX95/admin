ALTER TABLE experiment_runs ALTER COLUMN cost_usd TYPE numeric(20,12);
ALTER TABLE experiment_runs ALTER COLUMN judge_cost_usd TYPE numeric(20,12);

CREATE TABLE model_cost_ledger (
  run_id text NOT NULL,
  part text NOT NULL CHECK(part IN ('main','judge')),
  model_id text NOT NULL,
  user_id text,
  module text NOT NULL CHECK(module IN ('experiments','evaluations')),
  amount_usd numeric(20,12) NOT NULL CHECK(amount_usd > 0),
  charged_at timestamptz NOT NULL,
  PRIMARY KEY(run_id,part)
);
CREATE INDEX model_cost_ledger_charged_idx ON model_cost_ledger(charged_at);
CREATE INDEX model_cost_ledger_dimensions_idx ON model_cost_ledger(model_id,user_id,module,charged_at);

INSERT INTO model_cost_ledger(run_id,part,model_id,user_id,module,amount_usd,charged_at)
SELECT r.id,'main',r.model_id,b.owner_id,
  CASE WHEN b.kind IN ('dataset','regression') THEN 'evaluations' ELSE 'experiments' END,
  r.cost_usd-COALESCE(r.judge_cost_usd,0),COALESCE(r.completed_at,r.created_at)
FROM experiment_runs r JOIN experiment_batches b ON b.id=r.batch_id
WHERE r.cost_usd-COALESCE(r.judge_cost_usd,0)>0;
INSERT INTO model_cost_ledger(run_id,part,model_id,user_id,module,amount_usd,charged_at)
SELECT r.id,'judge',COALESCE(r.judge_model_id,r.model_id),b.owner_id,
  CASE WHEN b.kind IN ('dataset','regression') THEN 'evaluations' ELSE 'experiments' END,
  r.judge_cost_usd,COALESCE(r.completed_at,r.created_at)
FROM experiment_runs r JOIN experiment_batches b ON b.id=r.batch_id
WHERE r.judge_cost_usd>0;

CREATE FUNCTION sync_model_cost_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_owner text;
  batch_module text;
  main_cost numeric(20,12);
BEGIN
  SELECT owner_id,CASE WHEN kind IN ('dataset','regression') THEN 'evaluations' ELSE 'experiments' END
    INTO batch_owner,batch_module FROM experiment_batches WHERE id=NEW.batch_id;
  main_cost := NEW.cost_usd-COALESCE(NEW.judge_cost_usd,0);
  IF main_cost < 0 THEN RAISE EXCEPTION 'Judge cost exceeds total run cost'; END IF;
  IF main_cost > 0 THEN
    INSERT INTO model_cost_ledger(run_id,part,model_id,user_id,module,amount_usd,charged_at)
    VALUES(NEW.id,'main',NEW.model_id,batch_owner,batch_module,main_cost,now())
    ON CONFLICT(run_id,part) DO UPDATE SET model_id=EXCLUDED.model_id,amount_usd=EXCLUDED.amount_usd;
  ELSE
    DELETE FROM model_cost_ledger WHERE run_id=NEW.id AND part='main';
  END IF;
  IF NEW.judge_cost_usd > 0 THEN
    INSERT INTO model_cost_ledger(run_id,part,model_id,user_id,module,amount_usd,charged_at)
    VALUES(NEW.id,'judge',COALESCE(NEW.judge_model_id,NEW.model_id),batch_owner,batch_module,NEW.judge_cost_usd,now())
    ON CONFLICT(run_id,part) DO UPDATE SET model_id=EXCLUDED.model_id,amount_usd=EXCLUDED.amount_usd;
  ELSE
    DELETE FROM model_cost_ledger WHERE run_id=NEW.id AND part='judge';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER experiment_runs_cost_ledger AFTER INSERT OR UPDATE OF cost_usd,judge_cost_usd,model_id,judge_model_id ON experiment_runs
FOR EACH ROW EXECUTE FUNCTION sync_model_cost_ledger();
