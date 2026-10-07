import crypto from 'node:crypto';
import { createBatch } from './experiment-platform.mjs';
import { nextScheduleAt, validTimeZone } from './experiment-schedule-time.mjs';
import { notifyUser } from './app-notifications.mjs';

const uuid=()=>crypto.randomUUID();
const ok=(data,status=200)=>({status,data});
const fail=(error,status=400)=>ok({error},status);
function scheduleConfig(body,timeZone){
  if(!validTimeZone(timeZone))throw new Error('账号时区无效');
  if(!['daily','weekly','monthly'].includes(body.frequency)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.localTime))throw new Error('频率或具体时间无效');
  if(body.frequency==='weekly'&&(!Number.isInteger(body.weekday)||body.weekday<0||body.weekday>6))throw new Error('周几必须为 0–6');
  if(body.frequency==='monthly'&&(!Number.isInteger(body.dayOfMonth)||body.dayOfMonth<1||body.dayOfMonth>31))throw new Error('每月日期须为 1–31');
  if(!body.variables||typeof body.variables!=='object'||Array.isArray(body.variables)||Object.values(body.variables).some(value=>typeof value!=='string'))throw new Error('固定变量必须为字符串映射');
  if(!Number.isInteger(body.retryLimit)||body.retryLimit<0||body.retryLimit>5)throw new Error('重试次数须为 0–5');
  return {frequency:body.frequency,localTime:body.localTime,weekday:body.frequency==='weekly'?body.weekday:null,dayOfMonth:body.frequency==='monthly'?body.dayOfMonth:null,variables:body.variables,retryLimit:body.retryLimit,timeZone};
}

export async function handleExperimentSchedules({pathname,method,client,me,readBody}){
  if(pathname==='/api/account/time-zone'){
    if(method==='GET')return ok({timeZone:me.timeZone||'Asia/Shanghai'});
    if(method==='PUT'){
      const body=await readBody();
      if(typeof body.timeZone!=='string'||!validTimeZone(body.timeZone))return fail('请输入有效的 IANA 时区');
      await client.query('UPDATE users SET time_zone=$2,updated_at=now() WHERE id=$1',[me.id,body.timeZone]);
      return ok({timeZone:body.timeZone});
    }
  }
  if(pathname==='/api/experiment-schedules'){
    if(method==='GET'){
      const rows=(await client.query('SELECT s.*,e.title FROM experiment_schedules s JOIN experiments e ON e.id=s.experiment_id WHERE $1=$2 OR s.owner_id=$3 ORDER BY s.created_at DESC',[me.role,'admin',me.id])).rows;
      return ok({items:rows.map(row=>({id:row.id,experimentId:row.experiment_id,title:row.title,ownerId:row.owner_id,timeZone:row.time_zone,frequency:row.frequency,localTime:row.local_time,weekday:row.weekday,dayOfMonth:row.day_of_month,variables:row.variables,retryLimit:row.retry_limit,active:row.active,failureStreak:row.failure_streak,nextRunAt:row.next_run_at}))});
    }
    if(method==='POST'){
      const body=await readBody();
      const experiment=(await client.query("SELECT owner_id FROM experiments WHERE id=$1 AND record_kind='definition'",[body.experimentId])).rows[0];
      if(!experiment)return fail('可执行实验不存在',404);
      if(me.role!=='admin'&&experiment.owner_id!==me.id)return fail('无权调度该实验',403);
      let config;
      try{config=scheduleConfig(body,me.timeZone||'Asia/Shanghai');}catch(error){return fail(error.message);}
      const nextRunAt=nextScheduleAt(config);
      const id=uuid();
      await client.query('INSERT INTO experiment_schedules(id,experiment_id,owner_id,time_zone,frequency,local_time,weekday,day_of_month,variables,retry_limit,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,body.experimentId,me.id,config.timeZone,config.frequency,config.localTime,config.weekday,config.dayOfMonth,JSON.stringify(config.variables),config.retryLimit,nextRunAt]);
      return ok({id,nextRunAt},201);
    }
  }
  const route=pathname.match(/^\/api\/experiment-schedules\/([^/]+)$/);
  if(route){
    const row=(await client.query('SELECT * FROM experiment_schedules WHERE id=$1',[route[1]])).rows[0];
    if(!row)return fail('调度不存在',404);
    if(me.role!=='admin'&&row.owner_id!==me.id)return fail('无权管理调度',403);
    if(method==='PATCH'){
      const body=await readBody();
      if(typeof body.active!=='boolean')return fail('active 必须是布尔值');
      const next=body.active?nextScheduleAt({frequency:row.frequency,localTime:row.local_time,timeZone:row.time_zone,weekday:row.weekday,dayOfMonth:row.day_of_month}):row.next_run_at;
      await client.query('UPDATE experiment_schedules SET active=$2,failure_streak=CASE WHEN $2 THEN 0 ELSE failure_streak END,next_run_at=$3,updated_at=now() WHERE id=$1',[row.id,body.active,next]);
      return ok({id:row.id,active:body.active,nextRunAt:next});
    }
    if(method==='DELETE'){
      await client.query('DELETE FROM experiment_schedules WHERE id=$1',[row.id]);
      return ok({deleted:true});
    }
  }
  return null;
}

export async function processDueExperimentSchedules(pool,limit=20){
  let processed=0;
  for(let index=0;index<limit;index++){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const schedule=(await client.query('SELECT * FROM experiment_schedules WHERE active=true AND next_run_at<=now() ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1')).rows[0];
      if(!schedule){await client.query('COMMIT');break;}
      const dueAt=schedule.next_run_at;
      const next=nextScheduleAt({frequency:schedule.frequency,localTime:schedule.local_time,timeZone:schedule.time_zone,weekday:schedule.weekday,dayOfMonth:schedule.day_of_month},new Date(dueAt).getTime()+1);
      await client.query('UPDATE experiment_schedules SET next_run_at=$2,updated_at=now() WHERE id=$1',[schedule.id,next]);
      const occurrenceId=uuid();
      const inserted=await client.query("INSERT INTO experiment_schedule_occurrences(id,schedule_id,due_at,status) VALUES($1,$2,$3,'queued') ON CONFLICT(schedule_id,due_at) DO NOTHING RETURNING id",[occurrenceId,schedule.id,dueAt]);
      if(inserted.rowCount){
        const owner=(await client.query("SELECT id,role,status FROM users WHERE id=$1",[schedule.owner_id])).rows[0];
        const attempt=owner?.status==='active'?await createBatch(client,schedule.experiment_id,owner,{variables:schedule.variables},'scheduled'):fail('调度账号不可用',409);
        if(attempt.status===202) await client.query('UPDATE experiment_schedule_occurrences SET batch_id=$2 WHERE id=$1',[occurrenceId,attempt.data.batchId]);
        else{
          await client.query("UPDATE experiment_schedule_occurrences SET status='failed',error=$2 WHERE id=$1",[occurrenceId,attempt.data.error]);
          const result=(await client.query('UPDATE experiment_schedules SET failure_streak=failure_streak+1,active=CASE WHEN failure_streak+1>=3 THEN false ELSE active END WHERE id=$1 RETURNING owner_id,experiment_id,failure_streak,active',[schedule.id])).rows[0];
          await notifyUser(client,schedule.owner_id,'schedule_failed',occurrenceId,'实验调度失败',attempt.data.error,`/experiments/${schedule.experiment_id}`);
          if(!result.active)await notifyUser(client,schedule.owner_id,'schedule_paused',schedule.id,'实验调度已暂停','连续三个调度周期失败。','/experiments/schedules');
        }
      }
      await client.query('COMMIT');processed++;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  return processed;
}
