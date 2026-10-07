import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPgTestServer} from './pg-helper.mjs';

test('Qwen image prompt preflights capability, snapshots media price, and records tool calls',async t=>{
  const calls=[];
  const fake=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req) raw+=chunk;
    const request=JSON.parse(raw);calls.push(request);
    const judge=JSON.stringify(request.messages).includes('根据问题');
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:judge?'{"score":4,"reason":"好"}':'已识别图片',tool_calls:judge?[]:[{id:'call-1',function:{name:'lookup',arguments:'{}'}}]}}],usage:{prompt_tokens:10,completion_tokens:5}}));
  });
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>fake.close(resolve)));
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'admin-prompt-run-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const api=await createPgTestServer(t,undefined,{QWEN_API_BASE_URL:`http://127.0.0.1:${fake.address().port}`,DASHSCOPE_API_KEY:'test',PROMPT_MEDIA_DIR:folder});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const token=(await login.json()).token;
  const call=async(path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
  const upload=await fetch(`${api.base}/prompt-media`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'x-media-kind':'image'},body:image});const asset=await upload.json();assert.equal(upload.status,201);
  const model=await call('/experiment-platform/models','POST',{displayName:'Qwen visual',apiModel:'qwen-local',provider:'qwen',capabilities:{input:['text','image'],output:['text'],tools:true},mediaPricing:{imageInputUsdEach:0.01},inputUsdPerMillion:1,outputUsdPerMillion:2});
  assert.equal(model.status,201);
  assert.equal((await call('/experiment-platform/config','PUT',{dailyBudgetUsd:1,concurrencyLimit:2,judgeModelId:model.data.id})).status,200);
  const prompt=await call('/prompts','POST',{name:'图像提示',content:'系统说明',format:'chat',toolSchema:{name:'lookup',parameters:{type:'object',properties:{}}},blocks:[{role:'user',parts:[{type:'text',text:'识别内容'},{type:'image',assetId:asset.id}]}]});
  assert.equal(prompt.status,201);
  const body={title:'媒体实验',systemPrompt:'系统说明',userPrompt:'',promptVersionId:prompt.data.versionId,variables:{},variants:[{modelId:model.data.id,label:'图像',parameters:{max_tokens:20}}]};
  const created=await call('/experiment-definitions','POST',body);assert.equal(created.status,201);
  const run=await call(`/experiment-definitions/${created.data.id}/run`,'POST',{variables:{}});assert.equal(run.status,202);
  let state;
  for(let index=0;index<50;index++){await new Promise(resolve=>setTimeout(resolve,100));state=(await call(`/experiment-batches/${run.data.batchId}`)).data;if(['completed','failed'].includes(state.status))break;}
  assert.equal(state.status,'completed');
  const recorded=(await api.client.query('SELECT provider,request_messages,tool_calls,media_usage,media_price_snapshot,reserved_media_cost,cost_usd FROM experiment_runs WHERE batch_id=$1',[run.data.batchId])).rows[0];
  assert.equal(recorded.provider,'qwen');assert.equal(recorded.media_usage.imageCount,1);assert.equal(Number(recorded.reserved_media_cost),0.01);
  assert.equal(Number(recorded.media_price_snapshot.imageInputUsdEach),0.01);assert.equal(recorded.tool_calls[0].function.name,'lookup');
  assert.ok(Number(recorded.cost_usd)>0.01);
  assert.match(calls[0].messages[1].content[1].image_url.url,/^data:image\/png;base64,/);
  assert.equal(calls[0].tools[0].function.name,'lookup');
  const unsupported=await call('/experiment-platform/models','POST',{displayName:'Text only',apiModel:'qwen-text',provider:'qwen',capabilities:{input:['text'],output:['text'],tools:false},mediaPricing:{},inputUsdPerMillion:1,outputUsdPerMillion:1});
  assert.equal(unsupported.status,201);
  const changed=await call(`/experiment-definitions/${created.data.id}`,'PUT',{...body,variants:[{modelId:unsupported.data.id,label:'text',parameters:{max_tokens:20}}]});assert.equal(changed.status,200);
  const rejected=await call(`/experiment-definitions/${created.data.id}/run`,'POST',{variables:{}});
  assert.equal(rejected.status,409);assert.match(rejected.data.error,/不支持/);
});
