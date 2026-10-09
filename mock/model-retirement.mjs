import { notifyUser } from './app-notifications.mjs';

export async function notifyModelReferenceOwners(client, model, kind, entityId) {
  const owners = (await client.query(`SELECT DISTINCT owner_id AS id FROM experiments e JOIN experiment_variants v ON v.experiment_id=e.id WHERE v.model_id=$1 AND owner_id IS NOT NULL
    UNION SELECT DISTINCT b.owner_id AS id FROM experiment_batches b JOIN experiment_runs r ON r.batch_id=b.id WHERE (r.model_id=$1 OR r.judge_model_id=$1) AND b.owner_id IS NOT NULL`, [model.id])).rows;
  for (const owner of owners) await notifyUser(client,owner.id,kind,entityId,
    kind === 'model_deprecated' ? `模型 ${model.display_name} 即将退役` : `模型 ${model.display_name} 已退役`,
    kind === 'model_deprecated' ? `该模型已停止接受新引用，计划于 ${new Date(model.retire_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} 自动退役。` : '该模型已退役，请切换已有实验或评测所用模型。',
    '/experiments');
}

export async function failQueuedModelRuns(client, modelId) {
  const batches = (await client.query("UPDATE experiment_runs SET status='failed',error='模型已退役',completed_at=now() WHERE status='queued' AND (model_id=$1 OR judge_model_id=$1) RETURNING batch_id", [modelId])).rows.map(row => row.batch_id);
  if (batches.length) await client.query(`UPDATE experiment_batches b SET
    status=CASE WHEN EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status IN ('queued','running')) THEN 'running'
      WHEN EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status='completed') THEN 'partial' ELSE 'failed' END,
    completed_at=CASE WHEN EXISTS(SELECT 1 FROM experiment_runs r WHERE r.batch_id=b.id AND r.status IN ('queued','running')) THEN NULL ELSE now() END
    WHERE b.id=ANY($1)`, [[...new Set(batches)]]);
  return batches.length;
}

export async function processDueModelRetirements(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(748205)');
    const due = (await client.query("UPDATE experiment_models SET status='retired',active=false,retired_at=now(),retire_at=NULL WHERE status='deprecated' AND retire_at<=now() RETURNING id,display_name")).rows;
    for (const model of due) { await failQueuedModelRuns(client,model.id); await notifyModelReferenceOwners(client,model,'model_retired',model.id); }
    await client.query('COMMIT');
    return due.length;
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
}
