import crypto from 'node:crypto';

const providers = new Set(['legacy','openai','qwen','gemini']);
const defaults = {
  legacy: '', openai: 'https://api.openai.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};
const environment = {
  legacy: ['MODEL_API_KEY','MODEL_API_BASE_URL'],
  openai: ['OPENAI_API_KEY','OPENAI_API_BASE_URL'],
  qwen: ['DASHSCOPE_API_KEY','QWEN_API_BASE_URL'],
  gemini: ['GEMINI_API_KEY','GEMINI_API_BASE_URL'],
};
function version() { return process.env.MODEL_CONNECTION_KEY_VERSION || 'v1'; }
function encryptionKey(keyVersion) {
  const current = keyVersion === version() ? process.env.MODEL_CONNECTION_MASTER_KEY : undefined;
  let prior;
  if (!current) {
    try { prior = JSON.parse(process.env.MODEL_CONNECTION_PREVIOUS_KEYS || '{}')[keyVersion]; }
    catch { throw new Error('模型连接旧密钥配置无效'); }
  }
  const encoded = current || prior;
  if (!encoded || !/^[0-9a-fA-F]{64}$/.test(encoded)) throw new Error('模型连接加密密钥不可用');
  return Buffer.from(encoded, 'hex');
}
function encrypt(value, id, field, keyVersion) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(keyVersion), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`${id}:${field}:${keyVersion}`));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { data, nonce, tag: cipher.getAuthTag() };
}
function decrypt(row, field) {
  const data = row[`${field}_cipher`];
  if (!data) return field === 'headers' ? '{}' : '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(row.key_version), row[`${field}_nonce`], { authTagLength: 16 });
  decipher.setAAD(Buffer.from(`${row.id}:${field}:${row.key_version}`));
  decipher.setAuthTag(row[`${field}_tag`]);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
function mask(key) { return key.length > 8 ? `${key.slice(0,4)}••••${key.slice(-4)}` : '••••'; }
function validUrl(raw) {
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 300) throw new Error('连接地址无效');
  let url;
  try { url = new URL(raw); } catch { throw new Error('连接地址无效'); }
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) throw new Error('连接地址无效');
  if (url.protocol !== 'https:' && !(process.env.ALLOW_LOCAL_MODEL_ENDPOINTS === '1' && ['127.0.0.1','localhost','::1'].includes(url.hostname))) throw new Error('连接地址必须使用 HTTPS');
  return url.toString().replace(/\/$/, '');
}
function validHeaders(headers) {
  if (headers === undefined || headers === null) return {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 10) throw new Error('请求头配置无效');
  for (const [name, value] of Object.entries(headers)) {
    if (!/^x-[a-z0-9-]{1,60}$/i.test(name) || typeof value !== 'string' || value.length > 500 || /[\r\n]/.test(value)) throw new Error('只允许不含换行的 X- 自定义请求头');
  }
  return headers;
}
function view(row) {
  return { id: row.id, provider: row.provider, name: row.name, baseUrl: row.base_url, keyMask: row.key_mask, isDefault: row.is_default, active: row.active, version: row.version, hasCustomHeaders: Boolean(row.headers_cipher), createdAt: row.created_at, updatedAt: row.updated_at };
}
async function audit(client, actorId, action, id) {
  await client.query('INSERT INTO security_audit_logs(actor_id,action,target_type,target_id) VALUES($1,$2,$3,$4)', [actorId, action, 'model_connection', id]);
}
export async function resolveModelConnection(client, provider, connectionId = null) {
  if (!providers.has(provider)) throw new Error('未知供应商');
  let row;
  if (connectionId) {
    row = (await client.query('SELECT * FROM model_connections WHERE id=$1 AND provider=$2 AND active=true', [connectionId, provider])).rows[0];
    if (!row) throw new Error('绑定的模型连接不可用');
  } else {
    row = (await client.query('SELECT * FROM model_connections WHERE provider=$1 AND is_default=true AND active=true', [provider])).rows[0];
  }
  if (row) {
    try { return { key: decrypt(row, 'key'), baseUrl: row.base_url || defaults[provider], headers: JSON.parse(decrypt(row, 'headers')) }; }
    catch { throw new Error('模型连接解密失败，请检查密钥版本'); }
  }
  const [keyName, baseName] = environment[provider];
  const key = process.env[keyName];
  const baseUrl = process.env[baseName] || defaults[provider];
  if (!key || !baseUrl) throw new Error(`${provider} 凭据未配置`);
  return { key, baseUrl: baseUrl.replace(/\/$/, ''), headers: {} };
}
export async function modelConnectionAvailable(client, model) {
  try { await resolveModelConnection(client, model.provider, model.connection_id); return true; }
  catch { return false; }
}
export async function handleModelConnections({ pathname, method, client, me, readBody }) {
  if (!pathname.startsWith('/api/settings/model-connections')) return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可管理模型连接' } };
  if (pathname === '/api/settings/model-connections' && method === 'GET') {
    return { status: 200, data: { items: (await client.query('SELECT * FROM model_connections ORDER BY provider,name')).rows.map(view) } };
  }
  if (pathname === '/api/settings/model-connections' && method === 'POST') {
    const body = await readBody();
    if (!providers.has(body.provider) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 500) throw new Error('供应商、名称和 API Key 为必填');
    const id = crypto.randomUUID(), keyVersion = version(), url = validUrl(body.baseUrl || null), headers = validHeaders(body.headers);
    const secret = encrypt(body.apiKey, id, 'key', keyVersion);
    const headerSecret = Object.keys(headers).length ? encrypt(JSON.stringify(headers), id, 'headers', keyVersion) : null;
    if (body.isDefault) await client.query('UPDATE model_connections SET is_default=false WHERE provider=$1', [body.provider]);
    const { rows } = await client.query('INSERT INTO model_connections(id,provider,name,base_url,key_cipher,key_nonce,key_tag,key_version,key_mask,headers_cipher,headers_nonce,headers_tag,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *', [id,body.provider,body.name.trim(),url,secret.data,secret.nonce,secret.tag,keyVersion,mask(body.apiKey),headerSecret?.data || null,headerSecret?.nonce || null,headerSecret?.tag || null,body.isDefault===true]);
    await audit(client, me.id, 'model_connection.created', id);
    return { status: 201, data: view(rows[0]) };
  }
  const route = pathname.match(/^\/api\/settings\/model-connections\/([0-9a-f-]{36})(?:\/(test))?$/);
  if (!route) return null;
  const row = (await client.query('SELECT * FROM model_connections WHERE id=$1', [route[1]])).rows[0];
  if (!row) return { status: 404, data: { error: '模型连接不存在' } };
  if (route[2] === 'test' && method === 'POST') {
    const body = await readBody();
    const model = (await client.query('SELECT id,provider,api_model FROM experiment_models WHERE id=$1 AND active=true', [body.modelId])).rows[0];
    if (!model || model.provider !== row.provider) return { status: 400, data: { error: '请选择同一供应商的已启用模型' } };
    const { completeWithProvider } = await import('./provider-adapters.mjs');
    try {
      await completeWithProvider(client, { provider: row.provider, connectionId: row.id, model: model.api_model, messages: [{ role: 'user', content: 'Reply OK.' }], parameters: { max_tokens: 1 }, timeoutMs: 10000 });
      await audit(client, me.id, 'model_connection.test_succeeded', row.id);
      return { status: 200, data: { ok: true } };
    } catch {
      await audit(client, me.id, 'model_connection.test_failed', row.id);
      return { status: 400, data: { error: '连接测试失败，请检查凭据、模型和供应商状态；测试可能产生少量费用' } };
    }
  }
  if (method === 'PUT' && !route[2]) {
    const body = await readBody();
    if (!Number.isInteger(body.version) || body.version !== row.version) return { status: 409, data: { error: '连接版本已过期' } };
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || typeof body.active !== 'boolean') throw new Error('连接名称或状态无效');
    const url = validUrl(body.baseUrl || null);
    const keyVersion = body.apiKey ? version() : row.key_version;
    const secret = body.apiKey ? encrypt(body.apiKey, row.id, 'key', keyVersion) : { data: row.key_cipher, nonce: row.key_nonce, tag: row.key_tag };
    if (body.apiKey && (typeof body.apiKey !== 'string' || body.apiKey.length > 500)) throw new Error('API Key 无效');
    const headers = body.headers === undefined ? null : validHeaders(body.headers);
    const headerSecret = headers === null ? { data: row.headers_cipher, nonce: row.headers_nonce, tag: row.headers_tag } : Object.keys(headers).length ? encrypt(JSON.stringify(headers), row.id, 'headers', keyVersion) : { data: null, nonce: null, tag: null };
    if (body.apiKey && headers === null && row.headers_cipher) throw new Error('轮换 API Key 时请同时重新填写自定义请求头，以便使用新密钥版本加密');
    if (body.isDefault && body.active) await client.query('UPDATE model_connections SET is_default=false WHERE provider=$1 AND id<>$2', [row.provider,row.id]);
    const updated = await client.query('UPDATE model_connections SET name=$2,base_url=$3,key_cipher=$4,key_nonce=$5,key_tag=$6,key_version=$7,key_mask=$8,headers_cipher=$9,headers_nonce=$10,headers_tag=$11,is_default=$12,active=$13,version=version+1,updated_at=now() WHERE id=$1 AND version=$14 RETURNING *', [row.id,body.name.trim(),url,secret.data,secret.nonce,secret.tag,keyVersion,body.apiKey?mask(body.apiKey):row.key_mask,headerSecret.data,headerSecret.nonce,headerSecret.tag,body.isDefault===true && body.active,body.active,body.version]);
    await audit(client, me.id, 'model_connection.updated', row.id);
    return { status: 200, data: view(updated.rows[0]) };
  }
  return { status: 405, data: { error: '不支持的操作' } };
}
