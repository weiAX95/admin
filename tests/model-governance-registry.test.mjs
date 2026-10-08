import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';

async function token(base, username, password) {
  const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
  return (await response.json()).token;
}
async function call(base, auth, path, method='GET', body) {
  const response=await fetch(`${base}${path}`,{method,headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
}

test('registry names are unique and member dropdown obeys model role allowlist', async t=>{
  const {base}=await createPgTestServer(t);
  const admin=await token(base,'admin','admin123');
  const member=await token(base,'member','test');
  const payload={name:'team.test',displayName:'Team Test',apiModel:'team-test',provider:'legacy',inputUsdPerMillion:2,outputUsdPerMillion:4,contextWindow:8192,maxOutputTokens:2048,featureTags:['json_mode'],allowedRoles:['admin']};
  const created=await call(base,admin,'/experiment-platform/models','POST',payload);
  assert.equal(created.status,201);
  assert.equal((await call(base,admin,'/experiment-platform/models','POST',{...payload,apiModel:'another'})).status,409);
  const config=(await call(base,admin,'/experiment-platform/config')).data;
  const model=config.models.find(item=>item.id===created.data.id);
  assert.equal(model.name,'team.test');
  assert.deepEqual(model.allowedRoles,['admin']);
  assert.equal(model.contextWindow,8192);
  assert.equal((await call(base,member,'/experiment-platform/config')).data.models.some(item=>item.id===model.id),false);
  const definition={title:'受限实验',taskId:null,systemPrompt:'',userPrompt:'问题',promptVersionId:null,variables:{},variants:[{modelId:model.id,label:'主模型',parameters:{max_tokens:128}}]};
  assert.equal((await call(base,member,'/experiment-definitions','POST',definition)).status,400);
  const edited=await call(base,admin,`/experiment-platform/models/${model.id}`,'PATCH',{...payload,active:true,allowedRoles:['admin','member'],status:'active'});
  assert.equal(edited.status,200);
  assert.equal((await call(base,member,'/experiment-platform/config')).data.models.some(item=>item.id===model.id),true);
  assert.equal((await call(base,member,'/experiment-definitions','POST',definition)).status,201);
  assert.equal((await call(base,admin,`/experiment-platform/models/${model.id}`,'PATCH',{...payload,active:true,status:'deprecated'})).status,200);
  assert.equal((await call(base,member,'/experiment-platform/config')).data.models.some(item=>item.id===model.id),false);
  assert.equal((await call(base,member,'/experiment-platform/models','POST',payload)).status,403);
  const catalogOnly=await call(base,admin,'/experiment-platform/models','POST',{...payload,name:'future.anthropic',apiModel:'future-model',provider:'anthropic',endpointUrl:'https://example.com/v1'});
  assert.equal(catalogOnly.status,201,JSON.stringify(catalogOnly.data));
  const future=(await call(base,admin,'/experiment-platform/config')).data.models.find(item=>item.id===catalogOnly.data.id);
  assert.equal(future.adapterReady,false);
  assert.equal(future.active,false);
});
