import crypto from 'node:crypto';
import { sha256 } from './postgres-store.mjs';

const uuid=()=>crypto.randomUUID();
const ok=(data,status=200)=>({status,data});
const fail=(error,status=400)=>ok({error},status);
const expiries={ '1h': 3600_000, '24h': 86_400_000, '7d': 7*86_400_000, permanent: null };
const owner=(row,me)=>me.role==='admin'||row.owner_id===me.id;

async function publicView(client, experimentId) {
  const experiment=(await client.query('SELECT * FROM experiments WHERE id=$1',[experimentId])).rows[0];
  if(!experiment)return null;
  if(experiment.record_kind==='manual')return {id:experiment.id,recordKind:'manual',title:experiment.title,taskId:experiment.task_id,prompt:experiment.prompt,model:experiment.model,params:experiment.params,result:experiment.result,score:experiment.score};
  const variants=(await client.query('SELECT v.label,m.display_name AS model,v.parameters FROM experiment_variants v JOIN experiment_models m ON m.id=v.model_id WHERE v.experiment_id=$1 AND v.active=true ORDER BY v.position',[experiment.id])).rows.map(row=>({label:row.label,model:row.model,parameters:row.parameters}));
  const batch=(await client.query("SELECT id,created_at,status FROM experiment_batches WHERE experiment_id=$1 AND status IN ('completed','partial') ORDER BY created_at DESC LIMIT 1",[experiment.id])).rows[0];
  const runs=batch?(await client.query('SELECT model_id,api_model,parameters,input_index,status,output,auto_score,prompt_tokens,completion_tokens,latency_ms,cost_usd FROM experiment_runs WHERE batch_id=$1 ORDER BY input_index,created_at',[batch.id])).rows.map(row=>({modelId:row.model_id,apiModel:row.api_model,parameters:row.parameters,inputIndex:row.input_index,status:row.status,output:row.output,autoScore:row.auto_score,promptTokens:row.prompt_tokens,completionTokens:row.completion_tokens,latencyMs:row.latency_ms,costUsd:row.cost_usd})):[];
  return {id:experiment.id,recordKind:'definition',title:experiment.title,taskId:experiment.task_id,systemPrompt:experiment.system_prompt,userPrompt:experiment.user_prompt,variables:experiment.variables,variants,latestBatch:batch?{createdAt:batch.created_at,status:batch.status,runs}:null};
}

export async function handlePublicExperimentShare({pathname,method,client}){
  const route=pathname.match(/^\/api\/public\/experiments\/([0-9a-f-]{36})$/);
  if(!route||method!=='GET')return null;
  const share=(await client.query('SELECT * FROM experiment_shares WHERE token_hash=$1',[sha256(route[1])])).rows[0];
  if(!share)return fail('分享链接不存在',404);
  if(share.revoked_at)return fail('分享已撤销',410);
  if(share.expires_at&&new Date(share.expires_at).getTime()<=Date.now())return fail('分享已过期',410);
  const experiment=await publicView(client,share.experiment_id);
  return experiment?ok({experiment,expiresAt:share.expires_at}):fail('实验已删除',404);
}

export async function canReadSharedExperimentAsset(pool, token, assetId) {
  if (!/^[0-9a-f-]{36}$/.test(token || '') || !/^[0-9a-f-]{36}$/.test(assetId || '')) return false;
  const share=(await pool.query('SELECT experiment_id FROM experiment_shares WHERE token_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())',[sha256(token)])).rows[0];
  if(!share)return false;
  const experiment=(await pool.query('SELECT prompt,result,system_prompt,user_prompt FROM experiments WHERE id=$1',[share.experiment_id])).rows[0];
  if(!experiment)return false;
  const latest=(await pool.query("SELECT id FROM experiment_batches WHERE experiment_id=$1 AND status IN ('completed','partial') ORDER BY created_at DESC LIMIT 1",[share.experiment_id])).rows[0];
  const outputs=latest?(await pool.query('SELECT output FROM experiment_runs WHERE batch_id=$1',[latest.id])).rows.map(row=>row.output):[];
  return [...Object.values(experiment),...outputs].some(value=>String(value||'').includes(`/api/assets/${assetId}`));
}

export async function handleExperimentSharing({pathname,method,client,me,readBody}){
  const preview=pathname.match(/^\/api\/experiments\/([^/]+)\/share-preview$/);
  if(preview&&method==='GET'){
    const experiment=await publicView(client,preview[1]);
    if(!experiment)return fail('实验不存在',404);
    const row=(await client.query('SELECT owner_id FROM experiments WHERE id=$1',[preview[1]])).rows[0];
    return owner(row,me)?ok({experiment}):fail('无权分享该实验',403);
  }
  const list=pathname.match(/^\/api\/experiments\/([^/]+)\/shares$/);
  if(list){
    const row=(await client.query('SELECT owner_id FROM experiments WHERE id=$1',[list[1]])).rows[0];
    if(!row)return fail('实验不存在',404);
    if(!owner(row,me))return fail('无权管理分享',403);
    if(method==='GET')return ok({items:(await client.query('SELECT id,expires_at,revoked_at,created_at FROM experiment_shares WHERE experiment_id=$1 ORDER BY created_at DESC',[list[1]])).rows});
    if(method==='POST'){
      const body=await readBody();
      if(!Object.hasOwn(expiries,body.expiry))return fail('分享期限无效');
      const token=uuid(),id=uuid();
      const expiresAt=expiries[body.expiry]===null?null:new Date(Date.now()+expiries[body.expiry]).toISOString();
      await client.query('INSERT INTO experiment_shares(id,experiment_id,created_by,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)',[id,list[1],me.id,sha256(token),expiresAt]);
      return ok({id,token,path:`/share/experiments/${token}`,expiresAt},201);
    }
  }
  const revoke=pathname.match(/^\/api\/experiment-shares\/([^/]+)\/revoke$/);
  if(revoke&&method==='POST'){
    const share=(await client.query('SELECT s.id,e.owner_id FROM experiment_shares s JOIN experiments e ON e.id=s.experiment_id WHERE s.id=$1',[revoke[1]])).rows[0];
    if(!share)return fail('分享不存在',404);
    if(!owner(share,me))return fail('无权撤销分享',403);
    await client.query('UPDATE experiment_shares SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1',[share.id]);
    return ok({revoked:true});
  }
  return null;
}
