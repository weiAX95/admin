import { notifyUser } from './app-notifications.mjs';

const validScope=new Set(['model','role','user']);
const day=()=>new Date().toISOString().slice(0,10);
const secondsToReset=()=>Math.max(1,Math.ceil((Date.parse(`${new Date(Date.now()+86400000).toISOString().slice(0,10)}T00:00:00Z`)-Date.now())/1000));
const pickLimit=(rows,role,userId)=>rows.find(row=>row.scope==='user'&&row.subject_id===userId)||rows.find(row=>row.scope==='role'&&row.subject_id===role)||rows.find(row=>row.scope==='model');

export async function handleModelQuotas({pathname,method,client,me,readBody}){
  if(pathname!=='/api/model-quotas')return null;
  if(me.role!=='admin')return {status:403,data:{error:'仅管理员可管理模型配额'}};
  if(method==='GET'){
    const items=(await client.query('SELECT q.*,m.display_name FROM model_token_quotas q JOIN experiment_models m ON m.id=q.model_id ORDER BY m.display_name,q.scope,q.subject_id')).rows;
    return {status:200,data:{items:items.map(row=>({modelId:row.model_id,modelName:row.display_name,scope:row.scope,subjectId:row.subject_id,dailyTokens:Number(row.daily_tokens)}))}};
  }
  if(method!=='PUT'&&method!=='DELETE')return null;
  const body=await readBody();
  if(typeof body?.modelId!=='string'||!validScope.has(body.scope)||typeof body.subjectId!=='string'||(body.scope==='model'&&body.subjectId!=='*')||(body.scope==='role'&&!['admin','member'].includes(body.subjectId))||(body.scope==='user'&&(!body.subjectId||body.subjectId==='*')))return {status:400,data:{error:'模型配额范围无效'}};
  if(!(await client.query('SELECT 1 FROM experiment_models WHERE id=$1',[body.modelId])).rowCount)return {status:404,data:{error:'模型不存在'}};
  if(body.scope==='user'&&!(await client.query('SELECT 1 FROM users WHERE id=$1',[body.subjectId])).rowCount)return {status:404,data:{error:'账号不存在'}};
  if(method==='DELETE'){
    await client.query('DELETE FROM model_token_quotas WHERE model_id=$1 AND scope=$2 AND subject_id=$3',[body.modelId,body.scope,body.subjectId]);
    return {status:200,data:{deleted:true}};
  }
  if(!Number.isSafeInteger(body.dailyTokens)||body.dailyTokens<1||body.dailyTokens>1_000_000_000)return {status:400,data:{error:'日 token 配额须为 1–1,000,000,000'}};
  await client.query('INSERT INTO model_token_quotas(model_id,scope,subject_id,daily_tokens) VALUES($1,$2,$3,$4) ON CONFLICT(model_id,scope,subject_id) DO UPDATE SET daily_tokens=EXCLUDED.daily_tokens,updated_at=now()',[body.modelId,body.scope,body.subjectId,body.dailyTokens]);
  return {status:200,data:{modelId:body.modelId,scope:body.scope,subjectId:body.subjectId,dailyTokens:body.dailyTokens}};
}

export async function checkTokenReservations(client,user,requests,{dryRun=false}={}){
  const requested=new Map();
  for(const item of requests){const previous=requested.get(item.modelId)||{tokens:0,needsContext:false};requested.set(item.modelId,{tokens:previous.tokens+item.tokens,needsContext:previous.needsContext||item.needsContext});}
  if(!requested.size)return {status:200,items:[]};
  await client.query('SELECT pg_advisory_xact_lock(748202)');
  const quotaDay=day(),items=[];
  for(const [modelId,request] of requested){
    const {tokens,needsContext}=request;
    const rows=(await client.query('SELECT scope,subject_id,daily_tokens FROM model_token_quotas WHERE model_id=$1',[modelId])).rows;
    const limit=pickLimit(rows,user.role,user.id);
    if(limit&&needsContext)return {status:409,data:{error:'带媒体的模型启用 token 配额前须配置上下文窗口上限',modelId}};
    const used=Number((await client.query('SELECT COALESCE(sum(reserved_tokens),0) AS total FROM model_token_reservations WHERE model_id=$1 AND user_id=$2 AND quota_day=$3',[modelId,user.id,quotaDay])).rows[0].total);
    if(limit&&used+tokens>Number(limit.daily_tokens))return {status:429,data:{error:'模型日 token 配额不足',modelId,scope:limit.scope,dailyTokens:Number(limit.daily_tokens),reservedTokens:used,requestedTokens:tokens,retryAfterSeconds:secondsToReset()}};
    items.push({modelId,tokens,used,limit:limit?Number(limit.daily_tokens):null,scope:limit?.scope||null,quotaDay});
  }
  return {status:200,items,dryRun};
}

export async function reserveRunTokens(client,user,requests,checked){
  for(const item of requests)await client.query('INSERT INTO model_token_reservations(run_id,model_id,user_id,quota_day,reserved_tokens) VALUES($1,$2,$3,$4,$5)',[item.runId,item.modelId,user.id,checked.items[0].quotaDay,item.tokens]);
  for(const item of checked.items){
    if(!item.limit)continue;
    const ratio=(item.used+item.tokens)/item.limit;
    for(const threshold of [80,90,100])if(ratio>=threshold/100&&item.used/item.limit<threshold/100){
      await notifyUser(client,user.id,'model_token_quota',`${item.modelId}:${item.quotaDay}:${threshold}`,`模型 token 配额达到 ${threshold}%`,`模型 ${item.modelId} 的当日预留已达 ${item.used+item.tokens}/${item.limit} token。`,'/experiments');
    }
  }
}
