import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPgTestServer} from './pg-helper.mjs';

function wav() {
  const pcm=Buffer.alloc(24000*2),data=Buffer.alloc(44+pcm.length);
  data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(24000,24);data.writeUInt32LE(48000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(pcm.length,40);pcm.copy(data,44);
  return data;
}

test('compatible media Judge sees generated image and its snapshotted price; rule score stays absent',async t=>{
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
  const requests=[];
  const fake=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;requests.push({path:req.url,body:JSON.parse(body)});
    res.writeHead(200,{'Content-Type':'application/json'});
    if(req.url.includes('image-model')) res.end(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:image.toString('base64')}}]}}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:3}}));
    else res.end(JSON.stringify({candidates:[{content:{parts:[{text:'{"score":4,"reason":"图像符合要求"}'}]}}],usageMetadata:{promptTokenCount:40,candidatesTokenCount:8}}));
  });
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>fake.close(resolve)));
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'prompt-media-judge-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const api=await createPgTestServer(t,undefined,{GEMINI_API_KEY:'test',GEMINI_API_BASE_URL:`http://127.0.0.1:${fake.address().port}`,PROMPT_MEDIA_DIR:folder});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const token=(await login.json()).token;
  const call=async(route,method='GET',body)=>{const response=await fetch(`${api.base}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const outputModel=await call('/experiment-platform/models','POST',{displayName:'图片模型',apiModel:'image-model',provider:'gemini',capabilities:{input:['text'],output:['image'],tools:false},mediaPricing:{imageOutputUsdEach:0.05},inputUsdPerMillion:1,outputUsdPerMillion:2});assert.equal(outputModel.status,201);
  const judgeModel=await call('/experiment-platform/models','POST',{displayName:'视觉 Judge',apiModel:'judge-model',provider:'gemini',capabilities:{input:['text','image'],output:['text'],tools:false},mediaPricing:{imageInputUsdEach:0.02},inputUsdPerMillion:1,outputUsdPerMillion:2});assert.equal(judgeModel.status,201);
  assert.equal((await call('/experiment-platform/config','PUT',{dailyBudgetUsd:1,concurrencyLimit:1,judgeModelId:judgeModel.data.id})).status,200);
  const definition=await call('/experiment-definitions','POST',{title:'图像评价',systemPrompt:'',userPrompt:'画一只猫',promptVersionId:null,variables:{},variants:[{modelId:outputModel.data.id,label:'图片',parameters:{max_tokens:100,output_kind:'image'}}]});assert.equal(definition.status,201);
  const estimate=await call(`/experiment-definitions/${definition.data.id}/estimate`,'POST',{kind:'single',variables:{}});assert.equal(estimate.status,200);assert.ok(estimate.data.estimatedMaxCostUsd>=0.28);
  const run=await call(`/experiment-definitions/${definition.data.id}/run`,'POST',{variables:{}});assert.equal(run.status,202);
  let state;for(let index=0;index<50;index++){await new Promise(resolve=>setTimeout(resolve,100));state=(await call(`/experiment-batches/${run.data.batchId}`)).data;if(['completed','failed'].includes(state.status))break;}
  assert.equal(state.status,'completed');assert.equal(requests.length,2);
  assert.equal(requests[1].body.contents[0].parts[1].inlineData.mimeType,'image/png');
  const saved=(await api.client.query('SELECT auto_score,judge_cost_usd,judge_media_price_snapshot,cost_usd FROM experiment_runs WHERE batch_id=$1',[run.data.batchId])).rows[0];
  const metric=(await api.client.query('SELECT rule_score,judge_score FROM experiment_run_metrics WHERE run_id=(SELECT id FROM experiment_runs WHERE batch_id=$1)',[run.data.batchId])).rows[0];
  assert.equal(Number(saved.auto_score),4);assert.equal(metric.rule_score,null);assert.equal(Number(metric.judge_score),4);assert.equal(saved.judge_media_price_snapshot.imageInputUsdEach,0.02);assert.ok(Number(saved.judge_cost_usd)>=0.02);assert.ok(Number(saved.cost_usd)>=0.07);
});

test('Gemini audio Judge receives WAV, prices actual seconds and produces an automatic score',async t=>{
  const audio=wav(),requests=[];
  const fake=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;requests.push({path:req.url,body:JSON.parse(body)});
    res.writeHead(200,{'Content-Type':'application/json'});
    if(req.url.includes('tts-model')) res.end(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/wav',data:audio.toString('base64')}}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:4}}));
    else res.end(JSON.stringify({candidates:[{content:{parts:[{text:'{"score":3.5,"reason":"语音清晰"}'}]}}],usageMetadata:{promptTokenCount:40,candidatesTokenCount:8}}));
  });
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>fake.close(resolve)));
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'prompt-audio-judge-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const api=await createPgTestServer(t,undefined,{GEMINI_API_KEY:'test',GEMINI_API_BASE_URL:`http://127.0.0.1:${fake.address().port}`,PROMPT_MEDIA_DIR:folder});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const token=(await login.json()).token;
  const call=async(route,method='GET',body)=>{const response=await fetch(`${api.base}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const outputModel=await call('/experiment-platform/models','POST',{displayName:'语音模型',apiModel:'tts-model',provider:'gemini',capabilities:{input:['text'],output:['audio'],tools:false},mediaPricing:{audioOutputUsdPerSecond:0.001},inputUsdPerMillion:1,outputUsdPerMillion:2});assert.equal(outputModel.status,201);
  const judgeModel=await call('/experiment-platform/models','POST',{displayName:'听觉 Judge',apiModel:'judge-model',provider:'gemini',capabilities:{input:['text','audio'],output:['text'],tools:false},mediaPricing:{audioInputUsdPerSecond:0.002},inputUsdPerMillion:1,outputUsdPerMillion:2});assert.equal(judgeModel.status,201);
  assert.equal((await call('/experiment-platform/config','PUT',{dailyBudgetUsd:5,concurrencyLimit:1,judgeModelId:judgeModel.data.id})).status,200);
  const definition=await call('/experiment-definitions','POST',{title:'语音评价',systemPrompt:'',userPrompt:'你好',promptVersionId:null,variables:{},variants:[{modelId:outputModel.data.id,label:'语音',parameters:{max_tokens:100,output_kind:'audio'}}]});assert.equal(definition.status,201);
  const estimate=await call(`/experiment-definitions/${definition.data.id}/estimate`,'POST',{kind:'single',variables:{}});assert.equal(estimate.status,200);assert.ok(estimate.data.estimatedMaxCostUsd>=1.8);
  const run=await call(`/experiment-definitions/${definition.data.id}/run`,'POST',{variables:{}});assert.equal(run.status,202);
  let state;for(let index=0;index<50;index++){await new Promise(resolve=>setTimeout(resolve,100));state=(await call(`/experiment-batches/${run.data.batchId}`)).data;if(['completed','failed'].includes(state.status))break;}
  assert.equal(state.status,'completed');assert.equal(requests.length,2);assert.equal(requests[1].body.contents[0].parts[1].inlineData.mimeType,'audio/wav');
  const saved=(await api.client.query('SELECT auto_score,judge_cost_usd,judge_media_price_snapshot,cost_usd FROM experiment_runs WHERE batch_id=$1',[run.data.batchId])).rows[0];
  assert.equal(Number(saved.auto_score),3.5);assert.equal(saved.judge_media_price_snapshot.audioInputUsdPerSecond,0.002);assert.ok(Number(saved.judge_cost_usd)>=0.002);assert.ok(Number(saved.cost_usd)>=0.003);
});
