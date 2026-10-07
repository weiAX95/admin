import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPgTestServer } from './pg-helper.mjs';

test('public sharing is hashed, live, expiring and revocable', async t => {
  const api=await createPgTestServer(t);
  const login=async(username,password)=>{const r=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});return(await r.json()).token;};
  const admin=await login('admin','admin123'),member=await login('member','test');
  const call=async(token,path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  const experiment=(await call(admin,'/experiments','POST',{title:'公开实验',prompt:'原提示',model:'manual',result:'原结果',score:3})).data;
  const pixel=Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64');
  const upload=await fetch(`${api.base}/assets`,{method:'POST',headers:{Authorization:`Bearer ${admin}`,'Content-Type':'image/gif'},body:pixel});
  const asset=(await upload.json()).url;
  await call(admin,`/experiments/${experiment.id}`,'PATCH',{prompt:`原提示 ![图](${asset})`});
  assert.equal((await call(member,`/experiments/${experiment.id}/shares`)).status,403);
  const preview=await call(admin,`/experiments/${experiment.id}/share-preview`);
  assert.ok(preview.data.experiment.prompt.includes(asset));
  const share=await call(admin,`/experiments/${experiment.id}/shares`,'POST',{expiry:'1h'});
  assert.equal(share.status,201);
  const rows=(await api.client.query('SELECT token_hash FROM experiment_shares WHERE id=$1',[share.data.id])).rows;
  assert.notEqual(rows[0].token_hash,share.data.token);
  const path=`/public/experiments/${share.data.token}`;
  assert.equal((await call(null,path)).data.experiment.result,'原结果');
  assert.equal((await fetch(`${api.base.replace(/\/api$/,'')}${asset}?share=${share.data.token}`)).status,200);
  await call(admin,`/experiments/${experiment.id}`,'PATCH',{result:'更新结果'});
  assert.equal((await call(null,path)).data.experiment.result,'更新结果');
  await call(admin,`/experiment-shares/${share.data.id}/revoke`,'POST',{});
  assert.equal((await call(null,path)).data.error,'分享已撤销');
  assert.equal((await fetch(`${api.base.replace(/\/api$/,'')}${asset}?share=${share.data.token}`)).status,401);
  const expiry=(await call(admin,`/experiments/${experiment.id}/shares`,'POST',{expiry:'24h'})).data;
  await api.client.query("UPDATE experiment_shares SET expires_at=now()-interval '1 second' WHERE id=$1",[expiry.id]);
  assert.equal((await call(null,`/public/experiments/${expiry.token}`)).data.error,'分享已过期');
});

test('scheduled run uses account timezone, dedupes occurrence and notifies on completion', async t => {
  const modelServer=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);const judge=body.messages[0].content.includes('根据问题');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:judge?'{"score":4,"reason":"ok"}':'结果'}}],usage:{prompt_tokens:10,completion_tokens:5}}));});
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>modelServer.close(resolve)));
  const api=await createPgTestServer(t,undefined,{MODEL_API_BASE_URL:`http://127.0.0.1:${modelServer.address().port}`,MODEL_API_KEY:'test'});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const {token}=await login.json();
  const call=async(path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  const model=(await call('/experiment-platform/models','POST',{displayName:'Test',apiModel:'test',inputUsdPerMillion:1,outputUsdPerMillion:2})).data;
  await call('/experiment-platform/config','PUT',{dailyBudgetUsd:10,concurrencyLimit:2,judgeModelId:model.id});
  const experiment=(await call('/experiment-definitions','POST',{title:'定时实验',systemPrompt:'系统',userPrompt:'{{question}}',variables:{question:'默认'},variants:[{modelId:model.id,label:'A',parameters:{max_tokens:100}}]})).data;
  assert.equal((await call('/account/time-zone','PUT',{timeZone:'Invalid/Zone'})).status,400);
  assert.equal((await call('/account/time-zone','PUT',{timeZone:'America/New_York'})).status,200);
  const schedule=await call('/experiment-schedules','POST',{experimentId:experiment.id,frequency:'daily',localTime:'09:00',variables:{question:'定时问题'},retryLimit:1});
  assert.equal(schedule.status,201);
  const zone=(await api.client.query('SELECT time_zone FROM experiment_schedules WHERE id=$1',[schedule.data.id])).rows[0].time_zone;
  assert.equal(zone,'America/New_York');
  await api.client.query("UPDATE experiment_schedules SET next_run_at=now()-interval '1 minute' WHERE id=$1",[schedule.data.id]);
  let occurrences=[];
  for(let index=0;index<80;index++){await new Promise(resolve=>setTimeout(resolve,100));occurrences=(await api.client.query('SELECT * FROM experiment_schedule_occurrences WHERE schedule_id=$1',[schedule.data.id])).rows;if(occurrences[0]?.status==='completed')break;}
  assert.equal(occurrences.length,1);
  assert.equal(occurrences[0].status,'completed');
  const count=(await api.client.query('SELECT count(*)::int AS n FROM experiment_schedule_occurrences WHERE schedule_id=$1',[schedule.data.id])).rows[0].n;
  assert.equal(count,1);
  const notifications=(await call('/notifications')).data.items;
  assert.ok(notifications.some(item=>item.kind==='experiment_completed'));
  await call(`/experiment-schedules/${schedule.data.id}`,'PATCH',{active:false});
  assert.equal((await call('/experiment-schedules')).data.items[0].active,false);
  await call(`/experiment-schedules/${schedule.data.id}`,'PATCH',{active:true});
  await call(`/experiment-schedules/${schedule.data.id}`,'DELETE');
  assert.equal((await call('/experiment-schedules')).data.items.length,0);
});

test('three failed schedule cycles pause once and retain failure notifications', async t => {
  const modelServer=http.createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(500);res.end('failure');});
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>modelServer.close(resolve)));
  const api=await createPgTestServer(t,undefined,{MODEL_API_BASE_URL:`http://127.0.0.1:${modelServer.address().port}`,MODEL_API_KEY:'test'});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});const {token}=await login.json();
  const call=async(path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  const model=(await call('/experiment-platform/models','POST',{displayName:'Bad',apiModel:'bad',inputUsdPerMillion:1,outputUsdPerMillion:1})).data;
  await call('/experiment-platform/config','PUT',{dailyBudgetUsd:10,concurrencyLimit:1,judgeModelId:model.id});
  const experiment=(await call('/experiment-definitions','POST',{title:'失败调度',systemPrompt:'',userPrompt:'hello',variables:{},variants:[{modelId:model.id,label:'A',parameters:{max_tokens:10}}]})).data;
  const schedule=(await call('/experiment-schedules','POST',{experimentId:experiment.id,frequency:'daily',localTime:'09:00',variables:{},retryLimit:0})).data;
  for(let cycle=1;cycle<=3;cycle++){
    await api.client.query("UPDATE experiment_schedules SET next_run_at=now()-($2::int * interval '1 minute') WHERE id=$1",[schedule.id,cycle]);
    let rows=[];
    for(let index=0;index<70;index++){await new Promise(resolve=>setTimeout(resolve,100));rows=(await api.client.query('SELECT status FROM experiment_schedule_occurrences WHERE schedule_id=$1 ORDER BY due_at',[schedule.id])).rows;if(rows.length===cycle&&rows.every(row=>row.status==='failed'))break;}
    assert.equal(rows.length,cycle);
    assert.ok(rows.every(row=>row.status==='failed'));
  }
  const state=(await api.client.query('SELECT active,failure_streak FROM experiment_schedules WHERE id=$1',[schedule.id])).rows[0];
  assert.equal(state.active,false);assert.equal(state.failure_streak,3);
  const notifications=(await call('/notifications')).data.items;
  assert.equal(notifications.filter(item=>item.kind==='schedule_paused').length,1);
});
