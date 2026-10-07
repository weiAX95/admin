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

test('Gemini TTS output reserves a maximum, stores WAV and charges actual duration',async t=>{
  const requests=[],audio=wav();
  const fake=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/wav',data:audio.toString('base64')}}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:4}}));});
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>fake.close(resolve)));
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'prompt-audio-out-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const api=await createPgTestServer(t,undefined,{GEMINI_API_KEY:'test',GEMINI_API_BASE_URL:`http://127.0.0.1:${fake.address().port}`,PROMPT_MEDIA_DIR:folder});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const token=(await login.json()).token;
  const call=async(route,method='GET',body)=>{const response=await fetch(`${api.base}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const model=await call('/experiment-platform/models','POST',{displayName:'Gemini TTS',apiModel:'gemini-tts-test',provider:'gemini',capabilities:{input:['text'],output:['audio'],tools:false},mediaPricing:{audioOutputUsdPerSecond:0.001},inputUsdPerMillion:1,outputUsdPerMillion:2});assert.equal(model.status,201);
  assert.equal((await call('/experiment-platform/config','PUT',{dailyBudgetUsd:1,concurrencyLimit:1,judgeModelId:null})).status,200);
  const body={title:'语音输出',systemPrompt:'',userPrompt:'Hello',promptVersionId:null,variables:{},variants:[{modelId:model.data.id,label:'语音',parameters:{output_kind:'audio',max_tokens:100}}]};
  const definition=await call('/experiment-definitions','POST',body);assert.equal(definition.status,201);
  const estimate=await call(`/experiment-definitions/${definition.data.id}/estimate`,'POST',{kind:'single',variables:{}});assert.equal(estimate.status,200);assert.ok(estimate.data.estimatedMaxCostUsd>=0.6);
  const run=await call(`/experiment-definitions/${definition.data.id}/run`,'POST',{variables:{}});assert.equal(run.status,202);
  let state;for(let i=0;i<50;i++){await new Promise(resolve=>setTimeout(resolve,100));state=(await call(`/experiment-batches/${run.data.batchId}`)).data;if(['completed','failed'].includes(state.status))break;}
  assert.equal(state.status,'completed');assert.deepEqual(requests[0].generationConfig.responseModalities,['AUDIO']);assert.equal(requests[0].generationConfig.responseFormat.audio.mimeType,'AUDIO_WAV');
  const saved=(await api.client.query('SELECT output_parts,media_usage,cost_usd,auto_score,score_reason FROM experiment_runs WHERE batch_id=$1',[run.data.batchId])).rows[0];
  assert.equal(saved.output_parts[0].type,'audio');assert.equal(saved.output_parts[0].durationSeconds,1);assert.equal(saved.media_usage.audioOutputSeconds,1);assert.ok(Number(saved.cost_usd)>=0.001&&Number(saved.cost_usd)<0.01);assert.equal(saved.auto_score,null);assert.match(saved.score_reason,/人工评分/);
  const downloaded=await fetch(`${api.base}/prompt-media/${saved.output_parts[0].assetId}`,{headers:{Authorization:`Bearer ${token}`}});assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),audio);
  const disallowed=await call(`/experiment-definitions/${definition.data.id}`,'PUT',{...body,systemPrompt:'你是助手'});assert.equal(disallowed.status,200);
  const rejected=await call(`/experiment-definitions/${definition.data.id}/run`,'POST',{variables:{}});assert.equal(rejected.status,409);assert.match(rejected.data.error,/纯文本/);
});
