import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPgTestServer} from './pg-helper.mjs';

async function fake(t,respond) {
  const server=http.createServer((req,res)=>{const result=respond(new URL(req.url,'http://localhost'));res.writeHead(result.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function auth(api,username='admin',password='admin123') {
  const response=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
  return (await response.json()).token;
}
async function sync(api,token,phase,body) {
  const response=await fetch(`${api.base}/prompts/sync/${phase}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
}

test('LangFuse sync pages versions, skips unmappable media and is idempotent',async t=>{
  const origin=await fake(t,url=>{
    if(url.pathname==='/api/public/v2/prompts') return {body:{data:url.searchParams.get('page')==='1'?[{name:'alpha',versions:[1,2,3],tags:['共享']}]:[{name:'beta',versions:[1],tags:[]}],meta:{page:Number(url.searchParams.get('page')),limit:100,totalItems:2,totalPages:2}}};
    if(url.pathname.endsWith('/alpha')) return {body:url.searchParams.get('version')==='1'?{type:'text',prompt:'Hello {{name}}'}:url.searchParams.get('version')==='2'?{type:'chat',prompt:[{role:'system',content:'You are kind'},{role:'user',content:'Hi'}]}:{type:'text',prompt:'sk-abcdefghijklmnop'}};
    return {body:{type:'chat',prompt:[{role:'user',content:[{type:'image',url:'https://example.com/a.png'}]}]}};
  });
  const api=await createPgTestServer(t,undefined,{PROMPT_SYNC_LANGFUSE_BASE_URL:origin,PROMPT_SYNC_LANGFUSE_PUBLIC_KEY:'pk-test',PROMPT_SYNC_LANGFUSE_SECRET_KEY:'sk-test',PROMPT_SYNC_ALLOWED_HOSTS:'127.0.0.1'});
  const token=await auth(api),member=await auth(api,'member','test');
  const forbidden=await sync(api,member,'preview',{provider:'langfuse'});assert.equal(forbidden.status,403);
  const preview=await sync(api,token,'preview',{provider:'langfuse'});
  assert.equal(preview.status,200);assert.equal(preview.data.validCount,2);assert.equal(preview.data.skippedCount,1);assert.equal(preview.data.externalSkipped.length,1);
  const stale=await sync(api,token,'confirm',{provider:'langfuse',expectedDigest:'old'});assert.equal(stale.status,409);
  const first=await sync(api,token,'confirm',{provider:'langfuse',expectedDigest:preview.data.digest});
  assert.equal(first.status,200);assert.equal(first.data.imported,2);
  const second=await sync(api,token,'confirm',{provider:'langfuse',expectedDigest:preview.data.digest});
  assert.equal(second.data.imported,0);
  assert.equal((await api.client.query('SELECT count(*)::int AS n FROM prompt_library_versions')).rows[0].n,2);
});

test('LangSmith sync reads prompt commits and skips unsupported manifests',async t=>{
  const origin=await fake(t,url=>{
    if(url.pathname==='/api/v1/repos') return {body:{repos:[{id:'repo-one',full_name:'owner/test',tags:[]}],total:1}};
    if(url.pathname==='/api/v1/commits/owner/test') return {body:{commits:[{commit_hash:'b',created_at:'2026-01-02T00:00:00Z'},{commit_hash:'a',created_at:'2026-01-01T00:00:00Z'}],total:2}};
    if(url.pathname.endsWith('/a')) return {body:{manifest:{kwargs:{template:'First {{value}}',template_format:'mustache'}}}};
    return {body:{manifest:{kwargs:{messages:[{type:'media'}]}}}};
  });
  const api=await createPgTestServer(t,undefined,{PROMPT_SYNC_LANGSMITH_BASE_URL:origin,PROMPT_SYNC_LANGSMITH_API_KEY:'test-key',PROMPT_SYNC_ALLOWED_HOSTS:'127.0.0.1'});
  const token=await auth(api);
  const preview=await sync(api,token,'preview',{provider:'langsmith'});
  assert.equal(preview.status,200);assert.equal(preview.data.validCount,1);assert.equal(preview.data.externalSkipped.length,1);
  const imported=await sync(api,token,'confirm',{provider:'langsmith',expectedDigest:preview.data.digest});
  assert.equal(imported.status,200);assert.equal(imported.data.imported,1);
  assert.equal((await api.client.query('SELECT content FROM prompt_library_versions')).rows[0].content,'First {{value}}');
});
