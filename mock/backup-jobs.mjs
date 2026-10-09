import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEncryptedBackup } from './backup-archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupDir = () => path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'));
const backupPath = id => path.join(backupDir(), `${id}.agbackup`);
const asPublic = row => ({ id: row.id, status: row.status, phase: row.phase, fileSize: row.file_size === null ? null : Number(row.file_size), fileCount: row.file_count, errorCode: row.error_code, createdAt: row.created_at, finishedAt: row.finished_at });
const respond = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };

async function runBackupJob(pool, id, onChanged) {
  try {
    await pool.query("UPDATE backup_jobs SET status='running',phase='dumping' WHERE id=$1", [id]);
    onChanged();
    const result = await createEncryptedBackup({
      outputPath: backupPath(id), keyHex: process.env.BACKUP_ENCRYPTION_KEY,
      assetDirs: [
        { dir: process.env.ASSET_DIR || path.join(root, 'mock/uploads'), prefix: 'assets' },
        { dir: process.env.PROMPT_MEDIA_DIR || path.join(root, 'mock/prompt-media'), prefix: 'prompt-media' },
      ],
      onPhase: async phase => { await pool.query('UPDATE backup_jobs SET phase=$2 WHERE id=$1', [id,phase]); onChanged(); },
    });
    const stat = await fsp.stat(result.path);
    await pool.query("UPDATE backup_jobs SET status='completed',phase='completed',file_size=$2,file_count=$3,finished_at=now() WHERE id=$1", [id,stat.size,result.manifest.files.length]);
  } catch (error) {
    await fsp.rm(backupPath(id), { force: true }).catch(() => undefined);
    await pool.query("UPDATE backup_jobs SET status='failed',phase='failed',error_code=$2,finished_at=now() WHERE id=$1", [id,error.code === 'ENOENT' ? 'TOOL_UNAVAILABLE' : 'BACKUP_FAILED']).catch(() => undefined);
    console.error('[backups] manual backup failed:', error.message);
  } finally { onChanged(); }
}

export async function recoverBackupJobs(pool) {
  const jobs = (await pool.query("UPDATE backup_jobs SET status='failed',phase='failed',error_code='INTERRUPTED',finished_at=now() WHERE status IN ('queued','running') RETURNING id")).rows;
  for (const row of jobs) await fsp.rm(backupPath(row.id), { force: true });
}

export async function handleBackupRequest(req, res, pool, lookupSession, onChanged = () => {}) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/api/settings/backups')) return false;
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const me = await lookupSession(token);
  if (!me) { respond(res, 401, { error: '未登录或登录已过期' }); return true; }
  if (me.role !== 'admin') { respond(res, 403, { error: '仅管理员可操作备份' }); return true; }
  if (pathname === '/api/settings/backups' && req.method === 'GET') {
    const items = (await pool.query('SELECT * FROM backup_jobs ORDER BY created_at DESC LIMIT 50')).rows.map(asPublic);
    respond(res, 200, { items });
    return true;
  }
  if (pathname === '/api/settings/backups' && req.method === 'POST') {
    if (!/^[a-f\d]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY || '')) { respond(res, 503, { error: '备份密钥未配置或格式无效' }); return true; }
    const id = crypto.randomUUID();
    try { await pool.query("INSERT INTO backup_jobs(id,requested_by,status,phase) VALUES($1,$2,'queued','queued')", [id,me.id]); }
    catch (error) { if (error.code === '23505') { respond(res, 409, { error: '已有备份任务正在执行' }); return true; } throw error; }
    respond(res, 202, { id, status: 'queued' });
    void runBackupJob(pool,id,onChanged);
    return true;
  }
  const download = pathname.match(/^\/api\/settings\/backups\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/download$/i);
  if (download && req.method === 'GET') {
    const id = download[1];
    const row = (await pool.query('SELECT status FROM backup_jobs WHERE id=$1', [id])).rows[0];
    if (!row) { respond(res, 404, { error: '备份不存在' }); return true; }
    if (row.status !== 'completed') { respond(res, 409, { error: '备份尚未完成' }); return true; }
    const file = backupPath(id);
    let stat;
    try { stat = await fsp.stat(file); } catch { respond(res, 404, { error: '备份文件不存在' }); return true; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename="backup-${id}.agbackup"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return true;
  }
  respond(res, 404, { error: '备份接口不存在' });
  return true;
}
