import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createPgTestServer } from './pg-helper.mjs';

test('measure 100-case loopback evaluation with fixed mock model and concurrency',async t=>{
  const modelServer=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);const judge=body.messages[0].content.includes('根据问题');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:judge?'{"score":4,"reason":"模拟评分"}':'答案'}}],usage:{prompt_tokens:10,completion_tokens:5}}));});
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>modelServer.close(resolve)));
  const api=await createPgTestServer(t,undefined,{MODEL_API_BASE_URL:`http://127.0.0.1:${modelServer.address().port}`,MODEL_API_KEY:'benchmark'});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const {token}=await login.json();
  const call=async(path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  const model=(await call('/experiment-platform/models','POST',{displayName:'Loopback model',apiModel:'loopback',inputUsdPerMillion:1,outputUsdPerMillion:1})).data;
  await call('/experiment-platform/config','PUT',{dailyBudgetUsd:100,concurrencyLimit:10,judgeModelId:model.id});
  const definition=(await call('/experiment-definitions','POST',{title:'100-case benchmark',systemPrompt:'系统',userPrompt:'{{question}}',variables:{question:'问题'},variants:[{modelId:model.id,label:'A',parameters:{max_tokens:20}}]})).data;
  const cases=Array.from({length:100},(_,index)=>({caseKey:`case-${index}`,variables:{question:`问题 ${index}`},referenceAnswer:'答案'}));
  const dataset=(await call('/experiment-datasets','POST',{name:'100-case benchmark',cases})).data;
  const started=performance.now();
  const batch=await call(`/experiment-definitions/${definition.id}/dataset-run`,'POST',{datasetVersionId:dataset.version.id,metricVersionId:'default-v1',variantIds:[definition.variants[0].id]});
  assert.equal(batch.status,202,JSON.stringify(batch.data));
  let detail;
  for(let index=0;index<1200;index++){await new Promise(resolve=>setTimeout(resolve,100));detail=(await call(`/experiment-batches/${batch.data.batchId}`)).data;if(['completed','partial','failed'].includes(detail.status))break;}
  assert.equal(detail.status,'completed');
  assert.equal(detail.runs.length,100);
  const elapsedMs=Math.round(performance.now()-started);
  const result={cases:100,elapsedMs,model:'loopback deterministic HTTP server',concurrency:10,network:'127.0.0.1 local loopback',host:{platform:process.platform,arch:process.arch,cpus:os.cpus().length,memoryGiB:Math.round(os.totalmem()/1024**3*10)/10}};
  console.log(`BENCHMARK ${JSON.stringify(result)}`);
});
