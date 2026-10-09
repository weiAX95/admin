import path from 'node:path';
import { restoreEncryptedBackup } from '../mock/backup-restore.mjs';

const archive = process.argv[2];
if (!archive || !process.env.DATABASE_URL || !process.env.RESTORE_DATABASE_URL || !process.env.BACKUP_ENCRYPTION_KEY) {
  console.error('用法：设置 DATABASE_URL、RESTORE_DATABASE_URL、BACKUP_ENCRYPTION_KEY、RESTORE_ASSET_DIR、RESTORE_PROMPT_MEDIA_DIR 后运行 npm run backup:restore:isolated -- /绝对路径/文件.agbackup');
  process.exit(1);
}
try {
  const result = await restoreEncryptedBackup({
    filePath: path.resolve(archive), keyHex: process.env.BACKUP_ENCRYPTION_KEY,
    sourceDatabaseUrl: process.env.DATABASE_URL, targetDatabaseUrl: process.env.RESTORE_DATABASE_URL,
    assetDir: process.env.RESTORE_ASSET_DIR, promptMediaDir: process.env.RESTORE_PROMPT_MEDIA_DIR,
  });
  console.log(`隔离恢复成功：${result.fileCount} 个文件；请核对数据与附件后，再按运维流程安排切换。`);
} catch (error) {
  console.error(`隔离恢复失败：${error.message}`);
  process.exitCode = 1;
}
