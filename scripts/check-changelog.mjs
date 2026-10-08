import fs from 'node:fs';
const entries = JSON.parse(fs.readFileSync(new URL('../CHANGELOG.json', import.meta.url), 'utf8'));
const versions = new Set();
for (const entry of entries) {
  if (!/^\d+\.\d+\.\d+$/.test(entry.version) || versions.has(entry.version)) throw new Error('更新日志版本号须为唯一的语义版本');
  versions.add(entry.version);
  for (const locale of ['zh', 'en']) {
    if (typeof entry[locale]?.title !== 'string' || !entry[locale].title.trim() || !Array.isArray(entry[locale]?.changes) || !entry[locale].changes.length || entry[locale].changes.some(change => typeof change !== 'string' || !change.trim())) throw new Error(`${entry.version} 缺少 ${locale} 更新说明`);
  }
}
const current = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
if (!versions.has(current)) throw new Error(`当前版本 ${current} 缺少更新日志`);
console.log(`Validated ${entries.length} bilingual changelog entries`);
