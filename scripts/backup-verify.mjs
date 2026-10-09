import path from 'node:path';
import { verifyEncryptedBackup } from '../mock/backup-archive.mjs';

const filePath = process.argv[2];
if (!filePath) { console.error('用法：npm run backup:verify -- /绝对路径/文件.agbackup'); process.exit(1); }
try {
  const manifest = await verifyEncryptedBackup({ filePath: path.resolve(filePath), keyHex: process.env.BACKUP_ENCRYPTION_KEY });
  console.log(`备份校验通过：${manifest.createdAt}，${manifest.files.length} 个文件`);
} catch (error) {
  console.error(`备份校验失败：${error.message}`);
  process.exitCode = 1;
}
