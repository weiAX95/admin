import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPgTestServer } from './pg-helper.mjs';
import { verifyEncryptedBackup } from '../mock/backup-archive.mjs';

test('admin starts a background encrypted backup and downloads it; member is denied', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-backup-jobs-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const key = 'ab'.repeat(32);
  const { base } = await createPgTestServer(t, undefined, { BACKUP_DIR: dir, BACKUP_ENCRYPTION_KEY: key });
  const login = async (username,password) => (await (await fetch(`${base}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) })).json()).token;
  const admin = await login('admin','admin123'), member = await login('member','test');
  const endpoint = `${base}/settings/backups`;
  assert.equal((await fetch(endpoint,{headers:{Authorization:`Bearer ${member}`}})).status,403);
  const start = await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${admin}`}});
  assert.equal(start.status,202);
  const { id } = await start.json();
  assert.equal((await fetch(`${endpoint}/${id}/download`,{headers:{Authorization:`Bearer ${member}`}})).status,403);
  let job;
  for (let attempt = 0; attempt < 100; attempt++) {
    job = (await (await fetch(endpoint,{headers:{Authorization:`Bearer ${admin}`}})).json()).items.find(item=>item.id===id);
    if (job?.status === 'completed' || job?.status === 'failed') break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(job.status,'completed',job.errorCode);
  assert.ok(job.fileSize > 0);
  const file = path.join(dir,`${id}.agbackup`);
  const manifest = await verifyEncryptedBackup({filePath:file,keyHex:key});
  assert.ok(manifest.files.some(item=>item.path==='database.dump'));
  const download = await fetch(`${endpoint}/${id}/download`,{headers:{Authorization:`Bearer ${admin}`}});
  assert.equal(download.status,200);
  assert.equal((await download.arrayBuffer()).byteLength,job.fileSize);
});
