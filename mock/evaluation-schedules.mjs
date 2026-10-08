import crypto from 'node:crypto';
import { createBatch } from './experiment-platform.mjs';
import { nextScheduleAt, validTimeZone } from './experiment-schedule-time.mjs';
import { notifyUser } from './app-notifications.mjs';

const uuid = () => crypto.randomUUID();
const ok = (data, status = 200) => ({ status, data });
const fail = (error, status = 400) => ok({ error }, status);

async function dispatch(client, schedule, dueAt) {
  const occurrenceId = uuid();
  const inserted = await client.query("INSERT INTO evaluation_schedule_occurrences(id,schedule_id,due_at,status) VALUES($1,$2,$3,'queued') ON CONFLICT(schedule_id,due_at) DO NOTHING RETURNING id", [occurrenceId,schedule.id,dueAt]);
  if (!inserted.rowCount) return null;
  const owner = (await client.query("SELECT id,role,status FROM users WHERE id=$1", [schedule.owner_id])).rows[0];
  const result = owner?.status === 'active' ? await createBatch(client,schedule.experiment_id,owner,{ datasetVersionId:schedule.dataset_version_id,metricVersionId:schedule.metric_version_id,variantIds:[schedule.variant_id] },'dataset') : fail('调度账号不可用',409);
  if (result.status === 202) await client.query('UPDATE evaluation_schedule_occurrences SET batch_id=$2 WHERE id=$1', [occurrenceId,result.data.batchId]);
  else {
    await client.query("UPDATE evaluation_schedule_occurrences SET status='failed',error=$2 WHERE id=$1", [occurrenceId,result.data.error]);
    for (const admin of (await client.query("SELECT id FROM users WHERE role='admin' AND status='active'")).rows) await notifyUser(client,admin.id,'evaluation_schedule_failed',occurrenceId,'定时评测未能启动',result.data.error,'/evaluation/schedules');
  }
  return { occurrenceId, ...result.data };
}

export async function handleEvaluationSchedules({ pathname, method, client, me, readBody }) {
  if (pathname === '/api/evaluation/schedules') {
    if (method === 'GET') return ok({ items: (await client.query("SELECT s.*,e.title FROM evaluation_schedules s JOIN experiments e ON e.id=s.experiment_id WHERE $1='admin' OR s.owner_id=$2 ORDER BY s.created_at DESC", [me.role,me.id])).rows });
    if (method === 'POST') {
      const body = await readBody();
      const experiment = (await client.query("SELECT owner_id FROM experiments WHERE id=$1 AND record_kind='definition' AND deleted_at IS NULL", [body.experimentId])).rows[0];
      if (!experiment) return fail('可执行实验不存在',404);
      if (me.role !== 'admin' && experiment.owner_id !== me.id) return fail('无权调度该实验',403);
      if (!(await client.query('SELECT 1 FROM experiment_variants WHERE id=$1 AND experiment_id=$2 AND active=true', [body.variantId,body.experimentId])).rowCount) return fail('变体不存在或已停用');
      if (!(await client.query('SELECT 1 FROM experiment_dataset_versions WHERE id=$1', [body.datasetVersionId])).rowCount) return fail('数据集版本不存在');
      if (!(await client.query('SELECT 1 FROM experiment_metric_versions WHERE id=$1', [body.metricVersionId])).rowCount) return fail('指标版本不存在');
      if (!['daily','weekly'].includes(body.frequency) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.localTime) || (body.frequency === 'weekly' && (!Number.isInteger(body.weekday) || body.weekday < 0 || body.weekday > 6))) return fail('频率或具体时间无效');
      const timeZone = me.timeZone || 'Asia/Shanghai';
      if (!validTimeZone(timeZone)) return fail('账号时区无效');
      const next = nextScheduleAt({ frequency:body.frequency,localTime:body.localTime,weekday:body.frequency === 'weekly' ? body.weekday : null,timeZone });
      const id = uuid();
      await client.query('INSERT INTO evaluation_schedules(id,owner_id,experiment_id,variant_id,dataset_version_id,metric_version_id,time_zone,frequency,local_time,weekday,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id,me.id,body.experimentId,body.variantId,body.datasetVersionId,body.metricVersionId,timeZone,body.frequency,body.localTime,body.frequency === 'weekly' ? body.weekday : null,next]);
      return ok({ id,nextRunAt:next },201);
    }
  }
  const route = pathname.match(/^\/api\/evaluation\/schedules\/([^/]+)(?:\/(run-now))?$/);
  if (!route) return null;
  const schedule = (await client.query('SELECT * FROM evaluation_schedules WHERE id=$1', [route[1]])).rows[0];
  if (!schedule) return fail('调度不存在',404);
  if (me.role !== 'admin' && schedule.owner_id !== me.id) return fail('无权管理该调度',403);
  if (route[2] === 'run-now' && method === 'POST') {
    const result = await dispatch(client,schedule,new Date());
    return result?.batchId ? ok(result,202) : fail(result?.error || '立即执行失败',409);
  }
  if (method === 'PATCH') {
    const body = await readBody();
    if (typeof body.active !== 'boolean') return fail('active 必须是布尔值');
    const next = body.active ? nextScheduleAt({ frequency:schedule.frequency,localTime:schedule.local_time,weekday:schedule.weekday,timeZone:schedule.time_zone }) : schedule.next_run_at;
    await client.query('UPDATE evaluation_schedules SET active=$2,next_run_at=$3,updated_at=now() WHERE id=$1', [schedule.id,body.active,next]);
    return ok({ id:schedule.id,active:body.active,nextRunAt:next });
  }
  if (method === 'DELETE') { await client.query('DELETE FROM evaluation_schedules WHERE id=$1', [schedule.id]); return ok({ deleted:true }); }
  return fail('不支持的调度操作',405);
}

export async function processDueEvaluationSchedules(pool, limit = 20) {
  let count = 0;
  for (let index = 0; index < limit; index++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const schedule = (await client.query('SELECT * FROM evaluation_schedules WHERE active=true AND next_run_at<=now() ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1')).rows[0];
      if (!schedule) { await client.query('COMMIT'); break; }
      const dueAt = schedule.next_run_at;
      const next = nextScheduleAt({ frequency:schedule.frequency,localTime:schedule.local_time,weekday:schedule.weekday,timeZone:schedule.time_zone },new Date(dueAt).getTime()+1);
      await client.query('UPDATE evaluation_schedules SET next_run_at=$2,updated_at=now() WHERE id=$1', [schedule.id,next]);
      await dispatch(client,schedule,dueAt);
      await client.query('COMMIT'); count++;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return count;
}
