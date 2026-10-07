import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPgTestServer} from './pg-helper.mjs';

test('OpenAI Responses image tool reserves one image and stores only verified bytes',async t=>{
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
  const requests=[];
  const fake=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({path:req.url,body:JSON.parse(body)});
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({output:[{type:'image_generation_call',status:'completed',result:image.toString('base64')}],usage:{input_tokens:12,output_tokens:3}}));
  });
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>fake.close(resolve)));
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'prompt-openai-image-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const api=await createPgTestServer(t,undefined,{OPENAI_API_KEY:'test',OPENAI_API_BASE_URL:`http://127.0.0.1:${fake.address().port}`,PROMPT_MEDIA_DIR:folder});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const token=(await login.json()).token;
  const call=async(route,method='GET',body)=>{const response=await fetch(`${api.base}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const model=await call('/experiment-platform/models','POST',{displayName:'OpenAI image',apiModel:'gpt-image-test',provider:'openai',capabilities:{input:['text'],output:['image'],tools:true},mediaPricing:{imageOutputUsdEach:0.05},inputUsdPerMillion:1,outputUsdPerMillion:2});assert.equal(model.status,201);
  assert.equal((await call('/experiment-platform/config','PUT',{dailyBudgetUsd:1,concurrencyLimit:1,judgeModelId:null})).status,200);
  const definition=await call('/experiment-definitions','POST',{title:'OpenAI 图片',systemPrompt:'',userPrompt:'画一只猫',promptVersionId:null,variables:{},variants:[{modelId:model.data.id,label:'图片',parameters:{max_tokens:100,output_kind:'image'}}]});assert.equal(definition.status,201);
  const estimate=await call(`/experiment-definitions/${definition.data.id}/estimate`,'POST',{kind:'single',variables:{}});assert.equal(estimate.status,200);assert.ok(estimate.data.estimatedMaxCostUsd>=0.05&&estimate.data.estimatedMaxCostUsd<0.1);
  const run=await call(`/experiment-definitions/${definition.data.id}/run`,'POST',{variables:{}});assert.equal(run.status,202);
  let state;for(let index=0;index<50;index++){await new Promise(resolve=>setTimeout(resolve,100));state=(await call(`/experiment-batches/${run.data.batchId}`)).data;if(['completed','failed'].includes(state.status))break;}
  assert.equal(state.status,'completed');assert.equal(requests[0].path,'/responses');assert.deepEqual(requests[0].body.tools,[{type:'image_generation',output_format:'png'}]);assert.deepEqual(requests[0].body.tool_choice,{type:'image_generation'});
  const saved=(await api.client.query('SELECT output_parts,media_usage,cost_usd,auto_score FROM experiment_runs WHERE batch_id=$1',[run.data.batchId])).rows[0];
  assert.equal(saved.output_parts[0].type,'image');assert.equal(saved.output_parts[0].data,undefined);assert.equal(saved.media_usage.imageOutputCount,1);assert.ok(Number(saved.cost_usd)>=0.05);assert.equal(saved.auto_score,null);
  const downloaded=await fetch(`${api.base}/prompt-media/${saved.output_parts[0].assetId}`,{headers:{Authorization:`Bearer ${token}`}});assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),image);
});
