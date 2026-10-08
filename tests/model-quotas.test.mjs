import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';
import { checkTokenReservations } from '../mock/model-quotas.mjs';

async function login(base,username,password){const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});return (await response.json()).token;}
async function call(base,token,path,method='GET',body){const response=await fetch(`${base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),retryAfter:response.headers.get('Retry-After')};}

test('model, role, user quota precedence and atomic 429 token reservations',async t=>{
  const {base,client}=await createPgTestServer(t,undefined,{EXPERIMENT_WORKER_MODE:'external',MODEL_API_BASE_URL:'https://example.com/v1',MODEL_API_KEY:'test-only'});
  const admin=await login(base,'admin','admin123'),member=await login(base,'member','test'),learner=await login(base,'learner','learn123');
  const model=await call(base,admin,'/experiment-platform/models','POST',{name:'quota.test',displayName:'Quota Test',apiModel:'quota-test',provider:'legacy',inputUsdPerMillion:1,outputUsdPerMillion:1,allowedRoles:['admin','member']});
  assert.equal(model.status,201);
  assert.equal((await call(base,admin,'/experiment-platform/config','PUT',{dailyBudgetUsd:100,concurrencyLimit:2,judgeModelId:model.data.id})).status,200);
  const payload={title:'配额实验',taskId:null,systemPrompt:'',userPrompt:'hello',promptVersionId:null,variables:{},variants:[{modelId:model.data.id,label:'模型',parameters:{max_tokens:128}}]};
  const definition=await call(base,member,'/experiment-definitions','POST',payload);
  assert.equal(definition.status,201);
  const path=`/experiment-definitions/${definition.data.id}/run`;
  const set=(scope,subjectId,dailyTokens)=>call(base,admin,'/model-quotas','PUT',{modelId:model.data.id,scope,subjectId,dailyTokens});
  assert.equal((await set('model','*',1)).status,200);
  const mediaCheck=await checkTokenReservations(client,{id:'member',role:'member'},[{modelId:model.data.id,tokens:100,needsContext:true}]);
  assert.equal(mediaCheck.status,409);
  let denied=await call(base,member,path,'POST',{variables:{}});
  assert.equal(denied.status,429);
  assert.ok(Number(denied.retryAfter)>0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM model_token_reservations')).rows[0].n,0);
  assert.equal((await set('role','member',2)).status,200);
  denied=await call(base,member,path,'POST',{variables:{}});
  assert.equal(denied.status,429);
  assert.equal(denied.data.scope,'role');
  assert.equal((await set('user','member',100000)).status,200);
  const accepted=await call(base,member,path,'POST',{variables:{}});
  assert.equal(accepted.status,202);
  const rows=(await client.query('SELECT * FROM model_token_reservations WHERE user_id=$1',['member'])).rows;
  assert.equal(rows.length,1);
  const reserved=Number(rows[0].reserved_tokens);
  assert.ok(reserved>128);
  assert.equal((await set('user','member',reserved)).status,200);
  denied=await call(base,member,path,'POST',{variables:{}});
  assert.equal(denied.status,429);
  assert.equal(denied.data.reservedTokens,reserved);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM experiment_batches WHERE owner_id=$1',['member'])).rows[0].n,1);
  const other=await call(base,learner,'/experiment-definitions','POST',payload);
  assert.equal(other.status,201);
  assert.equal((await set('user','learner',reserved+1)).status,200);
  assert.equal((await call(base,learner,`/experiment-definitions/${other.data.id}/run`,'POST',{variables:{}})).status,202);
  const notices=(await client.query("SELECT entity_id FROM app_notifications WHERE user_id='learner' AND kind='model_token_quota'")).rows;
  assert.equal(notices.length,2);
  const adminDefinition=await call(base,admin,'/experiment-definitions','POST',payload);
  assert.equal(adminDefinition.status,201);
  assert.equal((await set('user','admin',reserved)).status,200);
  const concurrent=await Promise.all([0,1].map(()=>call(base,admin,`/experiment-definitions/${adminDefinition.data.id}/run`,'POST',{variables:{}})));
  assert.deepEqual(concurrent.map(item=>item.status).sort(),[202,429]);
  assert.equal((await call(base,member,'/model-quotas')).status,403);
});
