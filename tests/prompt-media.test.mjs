import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPgTestServer} from './pg-helper.mjs';

function wav(seconds=1) {
  const pcm=Buffer.alloc(seconds*16000*2);
  const data=Buffer.alloc(44+pcm.length);
  data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);
  data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);
  data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(pcm.length,40);pcm.copy(data,44);
  return data;
}

test('authenticated prompt media validates image/audio bytes, duration, and typed block references',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'admin-prompt-media-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const api=await createPgTestServer(t,undefined,{PROMPT_MEDIA_DIR:folder,PROMPT_AUDIO_MAX_BYTES:'40000'});
  const login=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'admin123'})});
  const token=(await login.json()).token;
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
  const unauthorized=await fetch(`${api.base}/prompt-media`,{method:'POST',headers:{'x-media-kind':'image'},body:image});
  assert.equal(unauthorized.status,401);
  const upload=async(kind,body)=>{const response=await fetch(`${api.base}/prompt-media`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'x-media-kind':kind},body});return {status:response.status,data:await response.json()};};
  const savedImage=await upload('image',image);
  assert.equal(savedImage.status,201);assert.equal(savedImage.data.mimeType,'image/png');
  const savedAudio=await upload('audio',wav());
  assert.equal(savedAudio.status,201);assert.equal(savedAudio.data.mimeType,'audio/wav');
  assert.equal(savedAudio.data.durationSeconds,1);
  assert.equal((await upload('audio',wav(2))).status,413);
  assert.equal((await upload('video',Buffer.from('not video'))).status,415);
  const download=await fetch(`${api.base}/prompt-media/${savedImage.data.id}`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),image);
  const created=await fetch(`${api.base}/prompts`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'媒体提示',content:'识别图片',blocks:[{role:'user',parts:[{type:'text',text:'请识别'},{type:'image',assetId:savedImage.data.id}]}]})});
  assert.equal(created.status,201);
  const missing=await fetch(`${api.base}/prompts`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'缺失媒体',content:'失败',blocks:[{role:'user',parts:[{type:'image',assetId:'00000000-0000-0000-0000-000000000000'}]}]})});
  assert.equal(missing.status,400);
});
