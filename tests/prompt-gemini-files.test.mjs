import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPgTestServer} from './pg-helper.mjs';

function longWav() {
  const pcm=Buffer.alloc(44100*2*240),data=Buffer.alloc(44+pcm.length);
  data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(44100,24);data.writeUInt32LE(88200,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(pcm.length,40);pcm.copy(data,44);
  return data;
}

test('Gemini Files API carries >20 MB audio by URI instead of inlining base64',async t=>{
  let uploadBytes=0,mainRequest;
  const fake=http.createServer(async(req,res)=>{
    if(req.url==='/upload/v1beta/files') {for await(const _ of req){}res.writeHead(200,{'x-goog-upload-url':`http://127.0.0.1:${fake.address().port}/upload-target`});res.end('{}');return;}
    if(req.url==='/upload-target') {for await(const chunk of req)uploadBytes+=chunk.length;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({file:{name:'files/test',uri:'gemini://uploaded-audio',state:'PROCESSING'}}));return;}
    if(req.url==='/files/test') {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({file:{name:'files/test',uri:'gemini://uploaded-audio',state:'ACTIVE'}}));return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);if(!JSON.stringify(body).includes('根据问题'))mainRequest=body;
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({candidates:[{content:{parts:[{text:mainRequest===body?'音频摘要':'{"score":4,"reason":"可用"}'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}}));
  });
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>fake.close(resolve)));
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'prompt-files-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const api=await createPgTestServer(t,undefined,{GEMINI_API_KEY:'test',GEMINI_API_BASE_URL:`http://127.0.0.1:${fake.address().port}`,PROMPT_MEDIA_DIR:folder});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const token=(await login.json()).token;
  const call=async(route,method='GET',body)=>{const response=await fetch(`${api.base}${route}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const audio=longWav();assert.ok(audio.length>20*1024*1024);
  const uploaded=await fetch(`${api.base}/prompt-media`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'x-media-kind':'audio'},body:audio});const asset=await uploaded.json();assert.equal(uploaded.status,201);
  const model=await call('/experiment-platform/models','POST',{displayName:'Gemini audio',apiModel:'gemini-file',provider:'gemini',capabilities:{input:['text','audio'],output:['text'],tools:false},mediaPricing:{audioInputUsdPerSecond:0.001},inputUsdPerMillion:1,outputUsdPerMillion:1});assert.equal(model.status,201);
  assert.equal((await call('/experiment-platform/config','PUT',{dailyBudgetUsd:1,concurrencyLimit:1,judgeModelId:model.data.id})).status,200);
  const prompt=await call('/prompts','POST',{name:'长音频',content:'总结音频',format:'chat',blocks:[{role:'user',parts:[{type:'text',text:'总结这段音频'},{type:'audio',assetId:asset.id}]}]});assert.equal(prompt.status,201);
  const definition=await call('/experiment-definitions','POST',{title:'长音频实验',systemPrompt:'总结音频',userPrompt:'',promptVersionId:prompt.data.versionId,variables:{},variants:[{modelId:model.data.id,label:'音频',parameters:{max_tokens:20}}]});assert.equal(definition.status,201);
  const run=await call(`/experiment-definitions/${definition.data.id}/run`,'POST',{variables:{}});assert.equal(run.status,202);
  let state;for(let i=0;i<60;i++){await new Promise(resolve=>setTimeout(resolve,100));state=(await call(`/experiment-batches/${run.data.batchId}`)).data;if(['completed','failed'].includes(state.status))break;}
  assert.equal(state.status,'completed');assert.equal(uploadBytes,audio.length);
  const part=mainRequest.contents[0].parts.find(item=>item.fileData);
  assert.equal(part.fileData.fileUri,'gemini://uploaded-audio');
  assert.equal(JSON.stringify(mainRequest).includes('UklGR'),false);
});
