import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPgTestServer} from './pg-helper.mjs';

test('JSON and YAML prompt exports round-trip idempotently and scan imported secrets',async t=>{
  const api=await createPgTestServer(t);
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});
  const token=(await login.json()).token;
  const call=async(path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const created=(await call('/prompts','POST',{name:'导出测试',tags:['分类'],content:'欢迎 {{name}}',variables:[{name:'name',type:'string',required:true}]})).data;
  for(const format of ['json','yaml']) {
    const exported=await call(`/prompts/export?format=${format}&id=${created.id}`);
    assert.equal(exported.status,200);
    assert.match(exported.data.content,/欢迎/);
    const preview=await call('/prompts/import/preview','POST',{format,text:exported.data.content});
    assert.equal(preview.data.validCount,1);
    const first=await call('/prompts/import/confirm','POST',{format,text:exported.data.content});
    assert.equal(first.status,200);
    assert.equal(first.data.imported,0);
    assert.equal(first.data.skipped,1);
  }
  const document={schemaVersion:1,sourceKey:'external-test',prompts:[{sourceId:'source-one',name:'外来提示',tags:[],versions:[{id:'version-one',semver:'1.0.0',content:'可导入',type:'system',format:'text',variables:[],messages:[]},{id:'version-secret',semver:'1.0.1',content:'api_key=abcdefghijklmnop',type:'system',format:'text',variables:[],messages:[]}]}]};
  const text=JSON.stringify(document);
  const preview=await call('/prompts/import/preview','POST',{format:'json',text});
  assert.equal(preview.data.validCount,1);assert.equal(preview.data.skippedCount,1);
  const imported=await call('/prompts/import/confirm','POST',{format:'json',text});
  assert.equal(imported.status,200);assert.equal(imported.data.imported,1);assert.equal(imported.data.skipped,1);
  const repeat=await call('/prompts/import/confirm','POST',{format:'json',text});
  assert.equal(repeat.data.imported,0);
  assert.equal((await api.client.query("SELECT count(*)::int AS n FROM prompt_library WHERE name='外来提示'")).rows[0].n,1);
});

test('cross-database YAML import remaps fixed include versions and rejects cycles atomically',async t=>{
  const source=await createPgTestServer(t);
  const target=await createPgTestServer(t);
  const auth=async api=>{const response=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});return (await response.json()).token;};
  const sourceToken=await auth(source),targetToken=await auth(target);
  const call=async(api,token,path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const child=(await call(source,sourceToken,'/prompts','POST',{name:'child',content:'child'})).data;
  const parent=(await call(source,sourceToken,'/prompts','POST',{name:'parent',content:`include:prompt://${child.versionId}`})).data;
  const exported=(await call(source,sourceToken,'/prompts/export?format=yaml')).data;
  const imported=await call(target,targetToken,'/prompts/import/confirm','POST',{format:'yaml',text:exported.content});
  assert.equal(imported.status,200);assert.equal(imported.data.imported,2);
  const refs=(await target.client.query('SELECT source_version_id,target_version_id FROM prompt_version_includes')).rows;
  assert.equal(refs.length,1);assert.notEqual(refs[0].source_version_id,parent.versionId);assert.notEqual(refs[0].target_version_id,child.versionId);
  const repeat=await call(target,targetToken,'/prompts/import/confirm','POST',{format:'yaml',text:exported.content});
  assert.equal(repeat.data.imported,0);
  const cyclic={schemaVersion:1,sourceKey:'cycle',prompts:[{sourceId:'a',name:'A',versions:[{id:'a1',semver:'1.0.0',content:'include:prompt://b1'}]},{sourceId:'b',name:'B',versions:[{id:'b1',semver:'1.0.0',content:'include:prompt://a1'}]}]};
  const failed=await call(target,targetToken,'/prompts/import/confirm','POST',{format:'json',text:JSON.stringify(cyclic)});
  assert.equal(failed.status,409);
  assert.equal((await target.client.query("SELECT count(*)::int AS n FROM prompt_library WHERE name IN ('A','B')")).rows[0].n,0);
});
