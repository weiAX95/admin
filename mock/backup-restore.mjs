import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { extractEncryptedBackup } from './backup-archive.mjs';

function databaseConnection(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error('目标数据库 URL 无效');
  return {
    identity: `${url.hostname.toLowerCase()}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1))}`,
    name: decodeURIComponent(url.pathname.slice(1)),
    env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) },
  };
}

async function restoreDump(dump, target) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.PG_RESTORE_BIN || 'pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', `--dbname=${target.name}`, dump], { env: target.env, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`pg_restore 失败（退出码 ${code}）；目标数据库可能已有部分数据，请丢弃该隔离库`)));
  });
}

async function assertAbsent(destination) {
  try { await fs.lstat(destination); throw new Error(`恢复目标目录已存在：${destination}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function restoreEncryptedBackup({ filePath, keyHex, targetDatabaseUrl, sourceDatabaseUrl = process.env.DATABASE_URL, assetDir, promptMediaDir }) {
  if (!targetDatabaseUrl) throw new Error('必须指定隔离的目标数据库');
  const target = databaseConnection(targetDatabaseUrl);
  if (sourceDatabaseUrl && target.identity === databaseConnection(sourceDatabaseUrl).identity) throw new Error('禁止恢复到源数据库');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-restore-'));
  const staged = [];
  let restored = false;
  try {
    const manifest = await extractEncryptedBackup({ filePath, keyHex, directory: temporary });
    const roots = [
      { prefix: 'assets', destination: assetDir },
      { prefix: 'prompt-media', destination: promptMediaDir },
    ];
    for (const root of roots) {
      if (!manifest.files.some(file => file.path.startsWith(`${root.prefix}/`))) continue;
      if (!root.destination) throw new Error(`缺少 ${root.prefix} 恢复目标目录`);
      await assertAbsent(root.destination);
      await fs.mkdir(path.dirname(root.destination), { recursive: true });
      const staging = `${root.destination}.restore-${crypto.randomUUID()}`;
      staged.push({ staging, destination: root.destination });
      await fs.cp(path.join(temporary, root.prefix), staging, { recursive: true, errorOnExist: true, force: false });
    }
    const client = new pg.Client({ connectionString: targetDatabaseUrl });
    await client.connect();
    try {
      const count = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
      if (count.rows[0].n !== 0) throw new Error('恢复目标必须是空数据库');
    } finally { await client.end(); }
    await restoreDump(path.join(temporary, 'database.dump'), target);
    restored = true;
    for (const item of staged) await fs.rename(item.staging, item.destination);
    return { fileCount: manifest.files.length, createdAt: manifest.createdAt };
  } catch (error) {
    if (restored) throw new Error(`数据库已恢复但附件切换失败：${error.message}；请勿启用该目标库`);
    throw error;
  } finally {
    for (const item of staged) await fs.rm(item.staging, { recursive: true, force: true });
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
