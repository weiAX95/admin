import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';

const MAGIC = Buffer.from('AGBACKUP1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_MANIFEST_BYTES = 1024 * 1024;

function backupKey(keyHex) {
  if (!/^[a-f\d]{64}$/i.test(keyHex || '')) throw new Error('备份密钥必须是独立的 32 字节十六进制值');
  return Buffer.from(keyHex, 'hex');
}

async function run(program, args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${program} 失败（退出码 ${code}）`)));
  });
}

export async function dumpPostgres(target, databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('缺少 DATABASE_URL');
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error('DATABASE_URL 无效');
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
  if (url.searchParams.has('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');
  await run(process.env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', `--file=${target}`], env);
  await run(process.env.PG_RESTORE_BIN || 'pg_restore', ['--list', target], env);
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function assetFiles(root, prefix) {
  if (!root || !/^[a-z][a-z-]*$/.test(prefix || '')) throw new Error('附件备份目录配置无效');
  const files = [];
  async function visit(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error('附件目录包含符号链接，备份已拒绝');
      if (stat.isDirectory()) await visit(absolute);
      else if (stat.isFile()) files.push({ absolute, archivePath: `${prefix}/${path.relative(root, absolute).split(path.sep).join('/')}` });
      else throw new Error('附件目录包含不支持的文件类型');
    }
  }
  let rootStat;
  try { rootStat = await fsp.lstat(root); } catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('附件备份目录必须是普通目录');
  await visit(root);
  return files.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}

export async function createEncryptedBackup({ outputPath, assetDir, assetDirs, keyHex, dumpDatabase = dumpPostgres, onPhase = async () => {} }) {
  const key = backupKey(keyHex);
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'admin-backup-'));
  let created = false;
  try {
    const dump = path.join(temporary, 'database.dump');
    await dumpDatabase(dump);
    const roots = assetDirs || [{ dir: assetDir, prefix: 'assets' }];
    const files = [{ absolute: dump, archivePath: 'database.dump' }];
    for (const root of roots) files.push(...await assetFiles(root.dir, root.prefix));
    const manifest = { format: 1, createdAt: new Date().toISOString(), databaseFormat: 'pg_dump-custom', files: [] };
    for (const file of files) {
      const stat = await fsp.stat(file.absolute);
      manifest.files.push({ path: file.archivePath, size: stat.size, sha256: await sha256(file.absolute) });
    }
    await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    const iv = crypto.randomBytes(IV_BYTES);
    const handle = await fsp.open(outputPath, 'wx', 0o600);
    created = true;
    await handle.write(Buffer.concat([MAGIC, iv]));
    await handle.close();
    const zip = new yazl.ZipFile();
    for (const file of files) zip.addFile(file.absolute, file.archivePath, { compress: false });
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
    zip.end();
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    await pipeline(zip.outputStream, cipher, fs.createWriteStream(outputPath, { flags: 'a' }));
    await fsp.appendFile(outputPath, cipher.getAuthTag());
    await onPhase('verifying');
    await verifyEncryptedBackup({ filePath: outputPath, keyHex });
    return { path: outputPath, manifest };
  } catch (error) { if (created) await fsp.rm(outputPath, { force: true }); throw error; }
  finally { await fsp.rm(temporary, { recursive: true, force: true }); }
}

async function verifyZip(zipPath) {
  const zip = await new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
  return await new Promise((resolve, reject) => {
    const found = new Map();
    const manifestChunks = [];
    let settled = false;
    const fail = error => { if (!settled) { settled = true; zip.close(); reject(error); } };
    zip.on('error', fail);
    zip.on('entry', entry => {
      if (entry.fileName.startsWith('/') || entry.fileName.includes('\\') || entry.fileName.split('/').includes('..') || found.has(entry.fileName) || entry.fileName.endsWith('/')) return fail(new Error('备份包含非法文件路径'));
      zip.openReadStream(entry, (error, stream) => {
        if (error) return fail(error);
        const hash = crypto.createHash('sha256');
        let size = 0;
        stream.on('data', chunk => {
          size += chunk.length;
          if (entry.fileName === 'manifest.json') {
            if (size > MAX_MANIFEST_BYTES) { stream.destroy(new Error('备份清单过大')); return; }
            manifestChunks.push(chunk);
          } else hash.update(chunk);
        });
        stream.on('error', fail);
        stream.on('end', () => { found.set(entry.fileName, { size, sha256: hash.digest('hex') }); zip.readEntry(); });
      });
    });
    zip.on('end', () => {
      try {
        const manifest = JSON.parse(Buffer.concat(manifestChunks).toString('utf8'));
        if (manifest.format !== 1 || !Array.isArray(manifest.files) || found.size !== manifest.files.length + 1 || !found.has('database.dump')) throw new Error('备份清单不完整');
        if (new Set(manifest.files.map(item => item.path)).size !== manifest.files.length) throw new Error('备份清单包含重复路径');
        for (const item of manifest.files) {
          const actual = found.get(item.path);
          if (!actual || actual.size !== item.size || actual.sha256 !== item.sha256) throw new Error('备份文件校验失败');
        }
        settled = true;
        resolve(manifest);
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
}

async function withVerifiedArchive({ filePath, keyHex }, work) {
  const key = backupKey(keyHex);
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'admin-backup-verify-'));
  try {
    const handle = await fsp.open(filePath, 'r');
    let stat, header, tag;
    try {
      stat = await handle.stat();
      if (stat.size < MAGIC.length + IV_BYTES + TAG_BYTES + 1) throw new Error('备份文件不完整');
      header = Buffer.alloc(MAGIC.length + IV_BYTES); tag = Buffer.alloc(TAG_BYTES);
      await handle.read(header, 0, header.length, 0);
      await handle.read(tag, 0, tag.length, stat.size - TAG_BYTES);
    } finally { await handle.close(); }
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('备份格式无效');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    const zipPath = path.join(temporary, 'archive.zip');
    await pipeline(fs.createReadStream(filePath, { start: header.length, end: stat.size - TAG_BYTES - 1 }), decipher, fs.createWriteStream(zipPath, { mode: 0o600 }));
    const manifest = await verifyZip(zipPath);
    return await work(zipPath, manifest);
  } finally { await fsp.rm(temporary, { recursive: true, force: true }); }
}

export async function verifyEncryptedBackup(options) {
  return withVerifiedArchive(options, async (_zipPath, manifest) => manifest);
}

export async function extractEncryptedBackup({ filePath, keyHex, directory }) {
  return withVerifiedArchive({ filePath, keyHex }, async (zipPath, manifest) => {
    for (const file of manifest.files) {
      if (file.path !== 'database.dump' && !file.path.startsWith('assets/') && !file.path.startsWith('prompt-media/')) throw new Error('备份包含不支持的文件路径');
    }
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const zip = await new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('entry', entry => {
        if (entry.fileName === 'manifest.json') { zip.readEntry(); return; }
        const target = path.join(directory, ...entry.fileName.split('/'));
        fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }).then(() => {
          zip.openReadStream(entry, (error, stream) => {
            if (error) { reject(error); return; }
            pipeline(stream, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 })).then(() => zip.readEntry(), reject);
          });
        }, reject);
      });
      zip.on('end', resolve);
      zip.readEntry();
    });
    return manifest;
  });
}
