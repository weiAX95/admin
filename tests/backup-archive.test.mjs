import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEncryptedBackup, verifyEncryptedBackup } from '../mock/backup-archive.mjs';

test('encrypted backup verifies database and attachment hashes; tampering fails', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-backup-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'assets');
  await fs.mkdir(assets);
  await fs.writeFile(path.join(assets, '图像.png'), Buffer.from([1,2,3,4]));
  const key = 'ab'.repeat(32);
  const file = path.join(root, 'archive.agbackup');
  await createEncryptedBackup({ outputPath: file, assetDir: assets, keyHex: key, dumpDatabase: async target => fs.writeFile(target, 'PGDMP-fake') });
  const verified = await verifyEncryptedBackup({ filePath: file, keyHex: key });
  assert.equal(verified.files.length, 2);
  assert.ok(verified.files.some(item => item.path === 'assets/图像.png'));
  await assert.rejects(verifyEncryptedBackup({ filePath: file, keyHex: 'cd'.repeat(32) }));
  const bytes = await fs.readFile(file);
  bytes[30] ^= 1;
  await fs.writeFile(file, bytes);
  await assert.rejects(verifyEncryptedBackup({ filePath: file, keyHex: key }));
});

test('backup rejects symlinked attachment roots and invalid keys', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-backup-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'assets');
  await fs.mkdir(assets);
  await fs.symlink(assets, path.join(root, 'linked-assets'));
  const options = { outputPath: path.join(root, 'archive.agbackup'), assetDir: path.join(root, 'linked-assets'), keyHex: 'ab'.repeat(32), dumpDatabase: async target => fs.writeFile(target, 'PGDMP-fake') };
  await assert.rejects(createEncryptedBackup(options), /普通目录/);
  await assert.rejects(createEncryptedBackup({ ...options, keyHex: 'bad' }), /备份密钥/);
  await assert.rejects(fs.stat(options.outputPath), { code: 'ENOENT' });
});
