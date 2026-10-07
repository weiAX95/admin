import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {createPgTestServer} from './pg-helper.mjs';

test('media ZIP verifies hashes and imports prompt versions with remapped attachment IDs',async t=>{
  const sourceDir=await fs.mkdtemp(path.join(os.tmpdir(),'prompt-source-'));
  const targetDir=await fs.mkdtemp(path.join(os.tmpdir(),'prompt-target-'));
  t.after(async()=>{await fs.rm(sourceDir,{recursive:true,force:true});await fs.rm(targetDir,{recursive:true,force:true});});
  const source=await createPgTestServer(t,undefined,{PROMPT_MEDIA_DIR:sourceDir});
  const target=await createPgTestServer(t,undefined,{PROMPT_MEDIA_DIR:targetDir});
  const login=async api=>{
    const response=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});
    return (await response.json()).token;
  };
  const sourceToken=await login(source),targetToken=await login(target);
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
  const uploaded=await fetch(`${source.base}/prompt-media`,{method:'POST',headers:{Authorization:`Bearer ${sourceToken}`,'x-media-kind':'image'},body:image});
  const asset=await uploaded.json();assert.equal(uploaded.status,201);
  const created=await fetch(`${source.base}/prompts`,{method:'POST',headers:{Authorization:`Bearer ${sourceToken}`,'Content-Type':'application/json'},body:JSON.stringify({name:'含图片的提示',content:'请描述',blocks:[{role:'user',parts:[{type:'text',text:'描述图像'},{type:'image',assetId:asset.id}]}]})});
  assert.equal(created.status,201);
  const archive=await fetch(`${source.base}/prompts/archive`,{headers:{Authorization:`Bearer ${sourceToken}`}});
  assert.equal(archive.status,200);assert.match(archive.headers.get('content-type'),/zip/);
  const bytes=Buffer.from(await archive.arrayBuffer());
  const uploadArchive=async(endpoint,body)=>{
    const response=await fetch(`${target.base}/prompts/archive/${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${targetToken}`,'Content-Type':'application/zip'},body});
    return {status:response.status,data:await response.json()};
  };
  const preview=await uploadArchive('preview',bytes);
  assert.equal(preview.status,200);assert.equal(preview.data.validCount,1);
  const broken=await JSZip.loadAsync(bytes);
  broken.file(`media/${asset.id}`,Buffer.from('corrupted'),{createFolders:false});
  const tampered=await uploadArchive('confirm',await broken.generateAsync({type:'nodebuffer'}));
  assert.equal(tampered.status,400);assert.match(tampered.data.error,/大小不符|哈希不符/);
  assert.equal((await target.client.query('SELECT count(*)::int AS n FROM prompt_library')).rows[0].n,0);
  const imported=await uploadArchive('confirm',bytes);
  assert.equal(imported.status,200);assert.equal(imported.data.imported,1);
  const record=(await target.client.query('SELECT id,blocks FROM prompt_library_versions')).rows[0];
  const mappedId=record.blocks[0].parts[1].assetId;
  assert.notEqual(mappedId,asset.id);
  const saved=await fetch(`${target.base}/prompt-media/${mappedId}`,{headers:{Authorization:`Bearer ${targetToken}`}});
  assert.equal(saved.status,200);assert.deepEqual(Buffer.from(await saved.arrayBuffer()),image);
  const repeat=await uploadArchive('confirm',bytes);
  assert.equal(repeat.status,200);assert.equal(repeat.data.imported,0);
  assert.equal((await target.client.query('SELECT count(*)::int AS n FROM prompt_media_assets')).rows[0].n,1);
});
