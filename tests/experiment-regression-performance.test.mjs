import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPgTestServer } from './pg-helper.mjs';

test('measure 50-case regression on loopback fake model at concurrency 10', async t => {
  const modelServer=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);const judge=body.messages[0].content.includes('根据问题');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:judge?'{"score":4,"reason":"准确"}':'参考答案'}}],usage:{prompt_tokens:20,completion_tokens:10}}));});
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>modelServer.close(resolve)));
  const api=await createPgTestServer(t,undefined,{MODEL_API_BASE_URL:`http://127.0.0.1:${modelServer.address().port}`,MODEL_API_KEY:'test'});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const {token}=await login.json();
  const call=async(path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  const model=(await call('/experiment-platform/models','POST',{displayName:'Loopback',apiModel:'fake-local',inputUsdPerMillion:1,outputUsdPerMillion:1})).data;
  await call('/experiment-platform/config','PUT',{dailyBudgetUsd:10,concurrencyLimit:10,judgeModelId:model.id});
  const definition=(await call('/experiment-definitions','POST',{title:'50 条回归性能',systemPrompt:'请回答',userPrompt:'{{question}}',variables:{question:'默认'},variants:[{modelId:model.id,label:'A',parameters:{max_tokens:100}}]})).data;
  const cases=Array.from({length:50},(_,index)=>({caseKey:`case-${String(index+1).padStart(3,'0')}`,variables:{question:`问题 ${index+1}`},referenceAnswer:'参考答案',difficulty:'中等',category:'性能测试'}));
  const dataset=(await call('/experiment-datasets','POST',{name:'50 条基准',cases})).data;
  const baseline=(await call(`/experiment-definitions/${definition.id}/dataset-run`,'POST',{datasetVersionId:dataset.version.id,metricVersionId:'default-v1',variantIds:[definition.variants[0].id]})).data;
  for(let i=0;i<200;i++){await new Promise(resolve=>setTimeout(resolve,100));if((await call(`/experiment-batches/${baseline.batchId}`)).data.status==='completed')break;}
  const started=performance.now();
  const regression=await call(`/experiment-definitions/${definition.id}/regression`,'POST',{datasetVersionId:dataset.version.id,metricVersionId:'default-v1',baselineBatchId:baseline.batchId,variantIds:[definition.variants[0].id]});
  assert.equal(regression.status,202);
  let batch;
  for(let i=0;i<200;i++){await new Promise(resolve=>setTimeout(resolve,100));batch=(await call(`/experiment-batches/${regression.data.batchId}`)).data;if(batch.status==='completed')break;}
  const durationMs=Math.round(performance.now()-started);
  assert.equal(batch.status,'completed');
  assert.equal(batch.runs.length,50);
  console.log(`50-case regression: ${durationMs} ms; fake-local provider over 127.0.0.1, 10 workers, 100 HTTP model calls, no artificial network latency`);
});
