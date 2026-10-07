import crypto from 'node:crypto';
import { diffChars } from 'diff';

const id = () => crypto.randomUUID();
const ok = (data, status = 200) => ({ status, data });
const fail = (error, status = 400) => ok({ error }, status);
const canEdit = (row, me) => me.role === 'admin' || row.owner_id === me.id;
const types = new Set(['system', 'user', 'assistant', 'tool_description']);
const formats = new Set(['text', 'chat', 'tool']);
const variableTypes = new Set(['string', 'number', 'boolean', 'select']);

function validatedTags(value) {
  if (!Array.isArray(value) || value.length > 30 || value.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 32)) throw new Error('标签必须为最多 30 个非空字符串，每项不超过 32 字');
  return [...new Set(value.map(tag => tag.trim()))];
}

function validatedVersion(body) {
  const type = body.type || 'system', format = body.format || 'text';
  if (!types.has(type) || !formats.has(format)) throw new Error('提示词类型或格式无效');
  if (typeof body.content !== 'string' || body.content.length > 200_000) throw new Error('content 必须为不超过 20 万字的文本');
  const messages = body.messages || [];
  if (!Array.isArray(messages) || messages.length > 50 || messages.some(item => !item || !['system','user','assistant'].includes(item.role) || typeof item.content !== 'string')) throw new Error('消息序列无效');
  if (format === 'chat' && !messages.length) throw new Error('聊天格式至少需要一条消息');
  if (format === 'tool' && (!body.toolSchema || typeof body.toolSchema !== 'object' || Array.isArray(body.toolSchema))) throw new Error('工具格式需要 toolSchema');
  const variables = body.variables || [];
  if (!Array.isArray(variables) || variables.length > 100) throw new Error('变量列表无效');
  const seen = new Set();
  for (const item of variables) {
    if (!item || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name || '') || seen.has(item.name) || !variableTypes.has(item.type)) throw new Error('变量名称或类型无效、重复');
    seen.add(item.name);
    if (typeof item.required !== 'boolean') throw new Error('变量 required 必须为布尔值');
    if (item.type === 'select' && (!Array.isArray(item.options) || !item.options.length || item.options.some(value => typeof value !== 'string'))) throw new Error('select 变量需要字符串选项');
    if (item.defaultValue !== undefined && item.defaultValue !== null && !validValue(item, item.defaultValue)) throw new Error(`变量 ${item.name} 默认值类型无效`);
  }
  return { type, format, content: body.content, messages, toolSchema: body.toolSchema || null, variables, warnings: variables.filter(item => item.required && (item.defaultValue === undefined || item.defaultValue === null)).map(item => `${item.name} 为必填变量且没有默认值`) };
}

function validValue(variable, value) {
  if (variable.type === 'string') return typeof value === 'string';
  if (variable.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (variable.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string' && variable.options.includes(value);
}

export function fillPromptVersion(version, values = {}) {
  const resolved = {};
  for (const variable of version.variables) {
    const value = Object.hasOwn(values, variable.name) ? values[variable.name] : variable.defaultValue;
    if (value === undefined || value === null || (value === '' && variable.required)) {
      if (variable.required) throw new Error(`缺少必填变量 ${variable.name}`);
      continue;
    }
    if (!validValue(variable, value)) throw new Error(`变量 ${variable.name} 类型无效`);
    resolved[variable.name] = String(value);
  }
  const missing = [];
  const fill = text => text.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (match, name) => {
    if (resolved[name] === undefined) { missing.push(name); return match; }
    return resolved[name];
  });
  const content = fill(version.content);
  const messages = version.messages.map(message => ({ ...message, content: fill(message.content) }));
  if (missing.length) throw new Error(`未定义或未填写变量：${[...new Set(missing)].join('、')}`);
  return { content, messages };
}

function bump(previous, kind) {
  const [major, minor, patch] = previous.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const fixedFindings = text => {
  const findings = [];
  const add = (kind, regex) => { if (regex.test(text)) findings.push(kind); };
  add('secret', /(?:\bsk-[A-Za-z0-9_-]{12,}\b|\bapi[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_-]{12,})/i);
  add('phone', /(?<!\d)1[3-9]\d{9}(?!\d)/);
  add('identity', /(?<!\d)\d{17}[\dXx](?!\d)/);
  add('email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return findings;
};

export async function scanPrompt(client, body) {
  const text = [body.content, ...(body.messages || []).map(item => item.content), JSON.stringify(body.toolSchema || {})].join('\n');
  const findings = fixedFindings(text);
  const rules = (await client.query('SELECT name,pattern FROM prompt_compliance_rules WHERE active=true')).rows;
  for (const rule of rules) if (new RegExp(rule.pattern, 'u').test(text)) findings.push(`custom:${rule.name}`);
  return [...new Set(findings)];
}

async function compliance(client, body, me, promptId = null) {
  const findings = await scanPrompt(client, body);
  if (!findings.length) return null;
  const blocked = findings.includes('secret');
  if (blocked) {
    await client.query('INSERT INTO prompt_compliance_events(id,prompt_id,actor_id,findings,action) VALUES($1,$2,$3,$4,$5)', [id(), promptId, me.id, JSON.stringify(findings), 'blocked']);
    return fail('检测到疑似密钥，禁止保存', 422);
  }
  if (body.confirmFindings !== true) return fail(`检测到疑似敏感信息：${findings.join('、')}。请确认后重试`, 409);
  await client.query('INSERT INTO prompt_compliance_events(id,prompt_id,actor_id,findings,action) VALUES($1,$2,$3,$4,$5)', [id(), promptId, me.id, JSON.stringify(findings), 'confirmed']);
  return null;
}
export const checkPromptCompliance = compliance;

async function latest(client, promptId) {
  return (await client.query('SELECT * FROM prompt_library_versions WHERE prompt_id=$1 ORDER BY version DESC LIMIT 1', [promptId])).rows[0];
}

async function appendVersion(client, prompt, body, me, source = null) {
  const value = validatedVersion(body);
  const checked = await compliance(client, value && { ...body, ...value }, me, prompt.id);
  if (checked) return checked;
  const old = await latest(client, prompt.id);
  if (body.expectedVersionId && old?.id !== body.expectedVersionId) return fail('提示词版本已更新，请刷新后重试', 409);
  const kind = body.bump || 'patch';
  if (!['patch','minor','major'].includes(kind)) return fail('版本增量无效');
  const version = (old?.version || 0) + 1;
  const semver = old ? bump(old.semver, kind) : '1.0.0';
  const summary = source ? `恢复自 ${source.semver}` : old ? (old.content === value.content ? '变量或结构调整' : diffChars(old.content,value.content).filter(part=>part.added||part.removed).map(part=>`${part.added?'+':'−'}${part.value}`).join('').slice(0,100)) : '初始版本';
  const versionId = id();
  await client.query('INSERT INTO prompt_library_versions(id,prompt_id,version,semver,content,prompt_type,format,variables,messages,tool_schema,author_id,change_summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [versionId,prompt.id,version,semver,value.content,value.type,value.format,JSON.stringify(value.variables),JSON.stringify(value.messages),JSON.stringify(value.toolSchema),me.id,summary]);
  await client.query('UPDATE prompt_library SET updated_at=now() WHERE id=$1', [prompt.id]);
  return ok({ id: versionId, promptId: prompt.id, version, semver, warnings: value.warnings }, 201);
}

export async function handlePrompts({ pathname, method, client, me, readBody, url }) {
  if (pathname === '/api/prompt-compliance-rules' && method === 'GET') {
    if (me.role !== 'admin') return fail('仅管理员可管理合规规则',403);
    return ok({ items:(await client.query('SELECT id,name,pattern,active,created_at FROM prompt_compliance_rules ORDER BY created_at DESC')).rows });
  }
  if (pathname === '/api/prompt-compliance-rules' && method === 'POST') {
    if (me.role !== 'admin') return fail('仅管理员可管理合规规则',403);
    const body = await readBody();
    if (typeof body.name !== 'string' || !body.name.trim() || typeof body.pattern !== 'string' || !body.pattern || body.pattern.length > 120 || /[()+*?|]/.test(body.pattern)) return fail('规则名称或正则无效；只支持有限重复、不含分组与分支的模式');
    const bounds=[...body.pattern.matchAll(/\{(\d+)(?:,(\d+))?\}/g)];
    if (bounds.some(match=>Number(match[1])>32 || Number(match[2] || match[1])>32) || body.pattern.replace(/\{\d+(?:,\d+)?\}/g,'').includes('{') || body.pattern.replace(/\{\d+(?:,\d+)?\}/g,'').includes('}')) return fail('重复次数上限为 32');
    try { new RegExp(body.pattern,'u'); } catch { return fail('正则语法无效'); }
    const ruleId=id(); await client.query('INSERT INTO prompt_compliance_rules(id,name,pattern,created_by) VALUES($1,$2,$3,$4)',[ruleId,body.name.trim(),body.pattern,me.id]);
    return ok({id:ruleId},201);
  }
  const ruleRoute=pathname.match(/^\/api\/prompt-compliance-rules\/([^/]+)$/);
  if (ruleRoute && method === 'DELETE') {
    if (me.role !== 'admin') return fail('仅管理员可管理合规规则',403);
    const result=await client.query('DELETE FROM prompt_compliance_rules WHERE id=$1 RETURNING id',[ruleRoute[1]]);
    return result.rowCount ? ok({deleted:true}) : fail('规则不存在',404);
  }
  if (pathname === '/api/prompts' && method === 'GET') {
    const folder = url.searchParams.get('folderId');
    const items = (await client.query(`SELECT p.id,p.name,p.owner_id,p.folder_id,p.tags,p.updated_at,v.id AS version_id,v.semver,v.content,v.prompt_type,v.format
      FROM prompt_library p LEFT JOIN LATERAL (SELECT * FROM prompt_library_versions WHERE prompt_id=p.id ORDER BY version DESC LIMIT 1) v ON true
      WHERE p.deleted_at IS NULL AND ($1::text IS NULL OR p.folder_id=$1) ORDER BY p.updated_at DESC LIMIT 500`, [folder])).rows;
    return ok({ items });
  }
  if (pathname === '/api/prompts' && method === 'POST') {
    const body = await readBody();
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) return fail('名称为必填，最多 200 字');
    let tags, value;
    try { tags = validatedTags(body.tags || []); value = validatedVersion(body); } catch (error) { return fail(error.message); }
    if (body.folderId && !(await client.query('SELECT 1 FROM prompt_folders WHERE id=$1', [body.folderId])).rowCount) return fail('文件夹不存在', 404);
    const checked = await compliance(client, { ...body, ...value }, me);
    if (checked) return checked;
    const promptId = id(), versionId = id();
    await client.query('INSERT INTO prompt_library(id,name,owner_id,folder_id,tags) VALUES($1,$2,$3,$4,$5)', [promptId,body.name.trim(),me.id,body.folderId || null,tags]);
    await client.query('INSERT INTO prompt_library_versions(id,prompt_id,version,semver,content,prompt_type,format,variables,messages,tool_schema,author_id,change_summary) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [versionId,promptId,'1.0.0',value.content,value.type,value.format,JSON.stringify(value.variables),JSON.stringify(value.messages),JSON.stringify(value.toolSchema),me.id,'初始版本']);
    return ok({ id: promptId, versionId, semver: '1.0.0', warnings: value.warnings }, 201);
  }
  if (pathname === '/api/prompt-folders' && method === 'GET') return ok({ items: (await client.query('SELECT id,name,parent_id,created_at FROM prompt_folders ORDER BY name')).rows });
  if (pathname === '/api/prompt-folders' && method === 'POST') {
    if (me.role !== 'admin') return fail('仅管理员可管理文件夹', 403);
    const body = await readBody();
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) return fail('文件夹名称无效');
    if (body.parentId && !(await client.query('SELECT 1 FROM prompt_folders WHERE id=$1', [body.parentId])).rowCount) return fail('父文件夹不存在', 404);
    const folderId = id();
    await client.query('INSERT INTO prompt_folders(id,name,parent_id) VALUES($1,$2,$3)', [folderId,body.name.trim(),body.parentId || null]);
    return ok({ id: folderId }, 201);
  }
  const folderRoute = pathname.match(/^\/api\/prompt-folders\/([^/]+)$/);
  if (folderRoute && method === 'PATCH') {
    if (me.role !== 'admin') return fail('仅管理员可管理文件夹', 403);
    const body = await readBody();
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) return fail('文件夹名称无效');
    const result = await client.query('UPDATE prompt_folders SET name=$2 WHERE id=$1 RETURNING id', [folderRoute[1],body.name.trim()]);
    return result.rowCount ? ok({ id: folderRoute[1] }) : fail('文件夹不存在',404);
  }
  if (folderRoute && method === 'DELETE') {
    if (me.role !== 'admin') return fail('仅管理员可管理文件夹', 403);
    const children = (await client.query('SELECT count(*)::int AS n FROM prompt_folders WHERE parent_id=$1', [folderRoute[1]])).rows[0].n;
    const prompts = (await client.query('SELECT count(*)::int AS n FROM prompt_library WHERE folder_id=$1', [folderRoute[1]])).rows[0].n;
    if (children || prompts) return fail('文件夹不为空，请先移动子文件夹和提示词', 409);
    const result = await client.query('DELETE FROM prompt_folders WHERE id=$1 RETURNING id', [folderRoute[1]]);
    return result.rowCount ? ok({ deleted: true }) : fail('文件夹不存在',404);
  }
  const versionsRoute = pathname.match(/^\/api\/prompts\/([^/]+)\/versions$/);
  if (versionsRoute && method === 'GET') return ok({ items: (await client.query('SELECT v.*,u.name AS author_name FROM prompt_library_versions v LEFT JOIN users u ON u.id=v.author_id WHERE v.prompt_id=$1 ORDER BY v.version DESC', [versionsRoute[1]])).rows });
  if (versionsRoute && method === 'POST') {
    const body = await readBody();
    const prompt = (await client.query('SELECT * FROM prompt_library WHERE id=$1 FOR UPDATE', [versionsRoute[1]])).rows[0];
    if (!prompt || prompt.deleted_at) return fail('提示词不存在',404);
    if (!canEdit(prompt,me)) return fail('无权修改该提示词',403);
    try { return await appendVersion(client,prompt,body,me); } catch (error) { return fail(error.message); }
  }
  const restore = pathname.match(/^\/api\/prompts\/([^/]+)\/versions\/([^/]+)\/restore$/);
  if (restore && method === 'POST') {
    const body = await readBody();
    const prompt = (await client.query('SELECT * FROM prompt_library WHERE id=$1 FOR UPDATE', [restore[1]])).rows[0];
    if (!prompt || prompt.deleted_at) return fail('提示词不存在',404);
    if (!canEdit(prompt,me)) return fail('无权恢复该提示词',403);
    const source = (await client.query('SELECT * FROM prompt_library_versions WHERE id=$1 AND prompt_id=$2', [restore[2],prompt.id])).rows[0];
    if (!source) return fail('历史版本不存在',404);
    return appendVersion(client,prompt,{ content:source.content,type:source.prompt_type,format:source.format,variables:source.variables,messages:source.messages,toolSchema:source.tool_schema,expectedVersionId:body.expectedVersionId,confirmFindings:body.confirmFindings },me,source);
  }
  const promptRoute = pathname.match(/^\/api\/prompts\/([^/]+)$/);
  if (promptRoute && method === 'GET') {
    const prompt = (await client.query('SELECT * FROM prompt_library WHERE id=$1', [promptRoute[1]])).rows[0];
    if (!prompt) return fail('提示词不存在',404);
    return ok({ ...prompt, latest: await latest(client,prompt.id) });
  }
  if (promptRoute && method === 'PATCH') {
    const body = await readBody();
    const prompt = (await client.query('SELECT * FROM prompt_library WHERE id=$1 FOR UPDATE', [promptRoute[1]])).rows[0];
    if (!prompt || prompt.deleted_at) return fail('提示词不存在',404);
    if (!canEdit(prompt,me)) return fail('无权修改该提示词',403);
    let tags;
    try { tags = validatedTags(body.tags ?? prompt.tags); } catch (error) { return fail(error.message); }
    const name = body.name === undefined ? prompt.name : body.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 200) return fail('名称无效');
    const folderId = body.folderId === undefined ? prompt.folder_id : body.folderId;
    if (folderId && !(await client.query('SELECT 1 FROM prompt_folders WHERE id=$1', [folderId])).rowCount) return fail('文件夹不存在',404);
    await client.query('UPDATE prompt_library SET name=$2,tags=$3,folder_id=$4,updated_at=now() WHERE id=$1', [prompt.id,name.trim(),tags,folderId]);
    return ok({ id: prompt.id });
  }
  if (promptRoute && method === 'DELETE') {
    const prompt = (await client.query('SELECT * FROM prompt_library WHERE id=$1 FOR UPDATE', [promptRoute[1]])).rows[0];
    if (!prompt) return fail('提示词不存在',404);
    if (!canEdit(prompt,me)) return fail('无权删除该提示词',403);
    await client.query('UPDATE prompt_library SET deleted_at=coalesce(deleted_at,now()) WHERE id=$1', [prompt.id]);
    return ok({ deleted: true });
  }
  return null;
}
