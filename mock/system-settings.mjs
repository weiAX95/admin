const GLOBAL_COLUMNS = {
  systemName: 'system_name', logoUrl: 'logo_url', defaultTimezone: 'default_timezone',
  defaultLanguage: 'default_language', defaultDateFormat: 'default_date_format',
  defaultPageSize: 'default_page_size', sessionHours: 'session_hours',
};
const PREFERENCE_COLUMNS = {
  timezone: 'timezone', language: 'language', dateFormat: 'date_format',
  theme: 'theme', primaryColor: 'primary_color', density: 'density',
};
const LANGUAGE = new Set(['zh-CN', 'en-US']);
const DATE_FORMAT = new Set(['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY']);
const PAGE_SIZE = new Set([10, 20, 50, 100]);
const THEME = new Set(['dark', 'light']);
const DENSITY = new Set(['comfortable', 'compact']);

function validTimezone(value) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
  catch { return false; }
}
function validate(input, isGlobal) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置内容必须是对象');
  const allowed = isGlobal ? GLOBAL_COLUMNS : PREFERENCE_COLUMNS;
  for (const [key, value] of Object.entries(input)) {
    if (key === 'version') continue;
    if (!(key in allowed)) throw new Error(`不支持的设置字段：${key}`);
    if (value === null && !isGlobal && ['timezone', 'language', 'dateFormat'].includes(key)) continue;
    if (key === 'systemName' && (typeof value !== 'string' || !value.trim() || value.length > 100)) throw new Error('系统名称长度须为 1–100 字符');
    if (key === 'logoUrl' && value !== null && (typeof value !== 'string' || !/^\/api\/assets\/[a-zA-Z0-9_-]+$/.test(value))) throw new Error('Logo 必须使用本站受检图片 URL');
    if ((key === 'timezone' || key === 'defaultTimezone') && (typeof value !== 'string' || !validTimezone(value))) throw new Error('无效时区');
    if ((key === 'language' || key === 'defaultLanguage') && !LANGUAGE.has(value)) throw new Error('无效语言');
    if ((key === 'dateFormat' || key === 'defaultDateFormat') && !DATE_FORMAT.has(value)) throw new Error('无效日期格式');
    if (key === 'defaultPageSize' && !PAGE_SIZE.has(value)) throw new Error('无效分页条数');
    if (key === 'sessionHours' && (!Number.isInteger(value) || value < 1 || value > 720)) throw new Error('会话时长须为 1–720 小时');
    if (key === 'theme' && !THEME.has(value)) throw new Error('无效主题');
    if (key === 'density' && !DENSITY.has(value)) throw new Error('无效密度');
    if (key === 'primaryColor' && (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))) throw new Error('主色须为 #RRGGBB');
  }
  if (!Number.isInteger(input.version) || input.version < (isGlobal ? 1 : 0)) throw new Error('缺少有效版本号');
}
function output(row, columns) {
  return Object.fromEntries([['version', row.version], ...Object.entries(columns).map(([key, column]) => [key, row[column]])]);
}
export async function getGlobalSettings(client) {
  const { rows } = await client.query('SELECT * FROM system_settings WHERE id=1');
  return output(rows[0], GLOBAL_COLUMNS);
}
export async function updateGlobalSettings(client, input) {
  validate(input, true);
  if (input.logoUrl) {
    const assetId = input.logoUrl.split('/').pop();
    const exists = await client.query('SELECT 1 FROM media_assets WHERE id=$1', [assetId]);
    if (!exists.rowCount) throw new Error('Logo 图片不存在');
  }
  const changes = Object.entries(input).filter(([key]) => key !== 'version');
  if (!changes.length) throw new Error('没有设置变化');
  const sets = changes.map(([key], index) => `${GLOBAL_COLUMNS[key]}=$${index + 1}`);
  const values = changes.map(([key, value]) => key === 'systemName' ? value.trim() : value);
  const { rows } = await client.query(`UPDATE system_settings SET ${sets.join(',')},version=version+1,updated_at=now() WHERE id=1 AND version=$${values.length+1} RETURNING *`, [...values, input.version]);
  return rows[0] ? { status: 200, data: output(rows[0], GLOBAL_COLUMNS) } : { status: 409, data: { error: '设置版本已过期，请刷新后重试' } };
}
export async function getUserPreferences(client, userId) {
  const { rows } = await client.query('SELECT * FROM user_preferences WHERE user_id=$1', [userId]);
  if (!rows.length) return { version: 0, timezone: null, language: null, dateFormat: null, theme: 'dark', primaryColor: '#9582ff', density: 'comfortable' };
  return output(rows[0], PREFERENCE_COLUMNS);
}
export async function updateUserPreferences(client, userId, input) {
  validate(input, false);
  const changes = Object.entries(input).filter(([key]) => key !== 'version');
  if (!changes.length) throw new Error('没有设置变化');
  const sets = changes.map(([key], index) => `${PREFERENCE_COLUMNS[key]}=$${index + 1}`);
  const values = changes.map(([, value]) => value);
  const { rows } = await client.query(`UPDATE user_preferences SET ${sets.join(',')},version=version+1,updated_at=now() WHERE user_id=$${values.length+1} AND version=$${values.length+2} RETURNING *`, [...values, userId, input.version]);
  if (rows[0]) return { status: 200, data: output(rows[0], PREFERENCE_COLUMNS) };
  if (input.version !== 0) return { status: 409, data: { error: '偏好版本已过期，请刷新后重试' } };
  const inserted = await client.query('INSERT INTO user_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING *', [userId]);
  if (!inserted.rows.length) return { status: 409, data: { error: '偏好版本已过期，请刷新后重试' } };
  return updateUserPreferences(client, userId, { ...input, version: 1 });
}
export async function handleSystemSettings({ pathname, method, client, me, readBody }) {
  if (pathname === '/api/settings/public' && method === 'GET') {
    const { systemName, logoUrl, defaultTimezone, defaultLanguage, defaultDateFormat, defaultPageSize } = await getGlobalSettings(client);
    return { status: 200, data: { systemName, logoUrl, defaultTimezone, defaultLanguage, defaultDateFormat, defaultPageSize } };
  }
  if (!me) return null;
  if (pathname === '/api/settings/global') {
    if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可管理全局设置' } };
    if (method === 'GET') return { status: 200, data: await getGlobalSettings(client) };
    if (method === 'PUT') return updateGlobalSettings(client, await readBody());
  }
  if (pathname === '/api/settings/preferences') {
    if (method === 'GET') return { status: 200, data: await getUserPreferences(client, me.id) };
    if (method === 'PUT') return updateUserPreferences(client, me.id, await readBody());
  }
  return null;
}
