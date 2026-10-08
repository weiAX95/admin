import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createPgTestServer } from './pg-helper.mjs';

test('measure a 10,000-case regression report over the local API', async t => {
  const api=await createPgTestServer(t);
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});
  const {token}=await login.json();
  const call=async(path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  const model=(await call('/experiment-platform/models','POST',{displayName:'Synthetic report',apiModel:'synthetic-report',inputUsdPerMillion:1,outputUsdPerMillion:1})).data;
  const definition=(await call('/experiment-definitions','POST',{title:'10k report',systemPrompt:'system',userPrompt:'{{question}}',variables:{question:'question'},variants:[{modelId:model.id,label:'A',parameters:{max_tokens:10}}]})).data;
  const cases=Array.from({length:10000},(_,index)=>({caseKey:`case-${String(index).padStart(5,'0')}`,variables:{question:`问题 ${index}`},referenceAnswer:'答案',difficulty:'中等',category:`分类 ${index%20}`}));
  const dataset=await call('/experiment-datasets','POST',{name:'10k report',cases});
  assert.equal(dataset.status,201,JSON.stringify(dataset.data).slice(0,300));
  const baselineId=randomUUID(),regressionId=randomUUID();
  await api.client.query(`INSERT INTO experiment_batches(id,experiment_id,owner_id,kind,status,inputs,dataset_version_id,metric_version_id,completed_at)
    VALUES($1,$3,'admin','dataset','completed','[]',$4,'default-v1',now()),($2,$3,'admin','regression','completed','[]',$4,'default-v1',now())`,[baselineId,regressionId,definition.id,dataset.data.version.id]);
  await api.client.query('UPDATE experiment_batches SET baseline_batch_id=$2 WHERE id=$1',[regressionId,baselineId]);
  for(const [id,prefix] of [[baselineId,'base-'],[regressionId,'current-']]) {
    await api.client.query(`INSERT INTO experiment_runs(id,batch_id,experiment_id,variant_id,case_id,input_index,status,system_prompt,user_prompt,model_id,api_model,parameters,input_price,output_price,reserved_usd,output,prompt_tokens,completion_tokens,latency_ms,cost_usd,auto_score,completed_at)
      SELECT $1||c.id,$2,$3,$4,c.id,row_number() OVER (ORDER BY c.case_key)-1,'completed','system','question',$5,'synthetic-report','{}',1,1,0,'答案',10,5,100,0.000015,4,now()
      FROM experiment_dataset_cases c WHERE c.dataset_version_id=$6`,[prefix,id,definition.id,definition.variants[0].id,model.id,dataset.data.version.id]);
    await api.client.query(`INSERT INTO experiment_run_metrics(id,run_id,metric_version_id,rule_score,judge_score,combined_score,passed,metric_details)
      SELECT 'metric-'||r.id,r.id,'default-v1',4,4,4,true,'{"exact":1,"token_f1":1}' FROM experiment_runs r WHERE r.batch_id=$1`,[id]);
  }
  const started=performance.now();
  const response=await fetch(`${api.base}/experiment-batches/${regressionId}/report`,{headers:{Authorization:`Bearer ${token}`}});
  const bytes=Buffer.from(await response.arrayBuffer());
  const report=JSON.parse(bytes.toString());
  const elapsedMs=Math.round(performance.now()-started);
  assert.equal(response.status,200);
  assert.equal(report.total,10000);
  assert.equal(report.cases.length,10000);
  assert.equal(report.byCategory.length,20);
  console.log(`BENCHMARK ${JSON.stringify({cases:10000,elapsedMs,responseBytes:bytes.length,model:'synthetic persisted runs, no model calls',network:'127.0.0.1 local API',host:{platform:process.platform,arch:process.arch,cpus:os.cpus().length,memoryGiB:Math.round(os.totalmem()/1024**3*10)/10}})}`);
});
