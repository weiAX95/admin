import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEncryptedBackup } from '../mock/backup-archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputPath = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'), `manual-${stamp}.agbackup`);
try {
  const result = await createEncryptedBackup({
    outputPath,
    keyHex: process.env.BACKUP_ENCRYPTION_KEY,
    assetDirs: [
      { dir: process.env.ASSET_DIR || path.join(root, 'mock/uploads'), prefix: 'assets' },
      { dir: process.env.PROMPT_MEDIA_DIR || path.join(root, 'mock/prompt-media'), prefix: 'prompt-media' },
    ],
  });
  console.log(`备份已加密并校验：${result.path}（${result.manifest.files.length} 个文件）`);
} catch (error) {
  console.error(`备份失败：${error.message}`);
  process.exitCode = 1;
}
