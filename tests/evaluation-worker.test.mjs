import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPgTestServer } from './pg-helper.mjs';

test('external worker resumes a persisted evaluation batch while API only enqueues',async t=>{
  const modelServer=http.createServer(async(req,res)=>{for await(const _ of req){};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'{"score":4,"reason":"ok"}'}}],usage:{prompt_tokens:10,completion_tokens:5}}));});
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>modelServer.close(resolve)));
  const api=await createPgTestServer(t,undefined,{MODEL_API_BASE_URL:`http://127.0.0.1:${modelServer.address().port}`,MODEL_API_KEY:'test',EXPERIMENT_WORKER_MODE:'external'});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});
  const {token}=await login.json();
  const call=async(path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  const batchProgress=async id=>{const {status,totalRuns,finishedRuns,failedRuns}=(await call(`/experiment-batches/${id}/progress`)).data;return{status,totalRuns,finishedRuns,failedRuns};};
  const model=(await call('/experiment-platform/models','POST',{displayName:'Worker test',apiModel:'test',inputUsdPerMillion:1,outputUsdPerMillion:1})).data;
  await call('/experiment-platform/config','PUT',{dailyBudgetUsd:10,concurrencyLimit:1,judgeModelId:model.id});
  const experiment=(await call('/experiment-definitions','POST',{title:'Worker task',systemPrompt:'系统',userPrompt:'{{question}}',variables:{question:'问题'},variants:[{modelId:model.id,label:'A',parameters:{max_tokens:10}}]})).data;
  const dataset=(await call('/experiment-datasets','POST',{name:'Worker dataset',cases:[{caseKey:'case-1',variables:{question:'问题'},referenceAnswer:'答案'}]})).data;
  const batch=await call(`/experiment-definitions/${experiment.id}/dataset-run`,'POST',{datasetVersionId:dataset.version.id,metricVersionId:'default-v1',variantIds:[experiment.variants[0].id]});
  assert.equal(batch.status,202,JSON.stringify(batch.data));
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal((await call(`/experiment-batches/${batch.data.batchId}`)).data.status,'queued');
  assert.deepEqual(await batchProgress(batch.data.batchId),{status:'queued',totalRuns:1,finishedRuns:0,failedRuns:0});
  const queuedDefinition=(await call(`/experiment-definitions/${experiment.id}`)).data;
  assert.deepEqual([queuedDefinition.batches[0].totalRuns,queuedDefinition.batches[0].finishedRuns,queuedDefinition.batches[0].failedRuns],[1,0,0]);
  const worker=spawn(process.execPath,[fileURLToPath(new URL('../mock/evaluation-worker.mjs',import.meta.url))],{env:{...process.env,DATABASE_URL:api.url,MODEL_API_BASE_URL:`http://127.0.0.1:${modelServer.address().port}`,MODEL_API_KEY:'test'},stdio:'ignore'});
  t.after(()=>{worker.kill('SIGTERM');});
  let status='queued';
  for(let index=0;index<70;index++){await new Promise(resolve=>setTimeout(resolve,100));status=(await call(`/experiment-batches/${batch.data.batchId}`)).data.status;if(status==='completed')break;}
  assert.equal(status,'completed');
  assert.deepEqual(await batchProgress(batch.data.batchId),{status:'completed',totalRuns:1,finishedRuns:1,failedRuns:0});
  const finishedDefinition=(await call(`/experiment-definitions/${experiment.id}`)).data;
  assert.deepEqual([finishedDefinition.batches[0].totalRuns,finishedDefinition.batches[0].finishedRuns,finishedDefinition.batches[0].failedRuns],[1,1,0]);
  assert.equal((await api.client.query('SELECT count(*)::int AS n FROM experiment_run_metrics m JOIN experiment_runs r ON r.id=m.run_id WHERE r.batch_id=$1',[batch.data.batchId])).rows[0].n,1);
  const schedule=await call('/evaluation/schedules','POST',{experimentId:experiment.id,variantId:experiment.variants[0].id,datasetVersionId:dataset.version.id,metricVersionId:'default-v1',frequency:'daily',localTime:'09:00'});
  assert.equal(schedule.status,201,JSON.stringify(schedule.data));
  const dueAt=new Date(Date.now()+1000);
  await api.client.query('UPDATE evaluation_schedules SET next_run_at=$2 WHERE id=$1',[schedule.data.id,dueAt]);
  let occurrence;
  for(let index=0;index<100;index++) {await new Promise(resolve=>setTimeout(resolve,100));occurrence=(await api.client.query('SELECT * FROM evaluation_schedule_occurrences WHERE schedule_id=$1',[schedule.data.id])).rows[0];if(occurrence)break;}
  assert.ok(occurrence?.batch_id,'worker should dispatch the due evaluation schedule');
  assert.ok(Date.now()-dueAt.getTime()<5000,'running worker should dispatch within 5 seconds of due time');
});
