import crypto from 'node:crypto';
import { diffChars } from 'diff';

const id = () => crypto.randomUUID();
const ok = (data, status = 200) => ({ status, data });
const fail = (error, status = 400) => ok({ error }, status);
const canEdit = (row, me) => me.role === 'admin' || row.owner_id === me.id;
const types = new Set(['system', 'user', 'assistant', 'tool_description']);
const formats = new Set(['text', 'chat', 'tool']);
const variableTypes = new Set(['string', 'number', 'boolean', 'select']);
const includePattern = /include:prompt:\/\/([A-Za-z0-9-]+)/g;
const directIncludes = value => [...new Set([value.content || '', ...(value.messages || []).map(item => item.content)].flatMap(text => [...text.matchAll(includePattern)].map(match => match[1])))];
function safePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 120 || /[()+*?|]/.test(pattern)) return false;
  const bounds=[...pattern.matchAll(/\{(\d+)(?:,(\d+))?\}/g)];
  if (bounds.some(match=>Number(match[1])>32 || Number(match[2] || match[1])>32)) return false;
  if (pattern.replace(/\{\d+(?:,\d+)?\}/g,'').includes('{') || pattern.replace(/\{\d+(?:,\d+)?\}/g,'').includes('}')) return false;
  try { new RegExp(pattern,'u'); return true; } catch { return false; }
}

async function expandIncludes(client, body, stack = [], found = new Map(), variables = new Map()) {
  for (const item of body.variables || []) {
    const previous = variables.get(item.name);
    if (previous && JSON.stringify(previous) !== JSON.stringify(item)) throw new Error(`变量 ${item.name} 在引用链中定义冲突`);
    variables.set(item.name,item);
  }
  const expand = async text => {
    let result = '', last = 0;
    for (const match of text.matchAll(includePattern)) {
      result += text.slice(last,match.index);
      const targetId=match[1];
      if (stack.includes(targetId)) throw new Error(`循环引用：${[...stack,targetId].join(' → ')}`);
      const target=(await client.query('SELECT * FROM prompt_library_versions WHERE id=$1',[targetId])).rows[0];
      if (!target) throw new Error(`被引用版本不存在：${targetId}`);
      found.set(targetId,target);
      const nested=await expandIncludes(client,target,[...stack,targetId],found,variables);
      result += nested.content;
      last=match.index+match[0].length;
    }
    return result+text.slice(last);
  };
  const content=await expand(body.content || '');
  const messages=[];
  for (const message of body.messages || []) messages.push({ ...message,content:await expand(message.content) });
  return {content,messages,versions:found,variables:[...variables.values()]};
}

export async function renderPromptVersion(client,version,values={}) {
  const expanded=await expandIncludes(client,version,[version.id]);
  const typed=Object.fromEntries(expanded.variables.map(variable=>{
    const input=values[variable.name];
    return [variable.name,input===undefined ? variable.defaultValue : variable.type==='number' && typeof input==='string' && input.trim()!=='' ? Number(input) : variable.type==='boolean' && typeof input==='string' ? input==='true' ? true : input==='false' ? false : input : input];
  }));
  const filled=fillPromptVersion(expanded,typed);
  return { ...filled, versionIds:[version.id,...expanded.versions.keys()], variables:expanded.variables };
}

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
  const expanded = await expandIncludes(client,value);
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
  for (const targetId of directIncludes(value)) await client.query('INSERT INTO prompt_version_includes(source_version_id,target_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[versionId,targetId]);
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
    if (typeof body.name !== 'string' || !body.name.trim() || !safePattern(body.pattern)) return fail('规则名称或正则无效；只支持有限重复、不含分组与分支的模式');
    const ruleId=id(); await client.query('INSERT INTO prompt_compliance_rules(id,name,pattern,created_by) VALUES($1,$2,$3,$4)',[ruleId,body.name.trim(),body.pattern,me.id]);
    return ok({id:ruleId},201);
  }
  const ruleRoute=pathname.match(/^\/api\/prompt-compliance-rules\/([^/]+)$/);
  if (ruleRoute && method === 'DELETE') {
    if (me.role !== 'admin') return fail('仅管理员可管理合规规则',403);
    const result=await client.query('DELETE FROM prompt_compliance_rules WHERE id=$1 RETURNING id',[ruleRoute[1]]);
    return result.rowCount ? ok({deleted:true}) : fail('规则不存在',404);
  }
  if (pathname === '/api/prompts/suggestions' && method === 'GET') {
    const term=(url.searchParams.get('q') || '').trim();
    if (!term) return ok({items:[]});
    if (term.length>100) return fail('搜索词过长');
    const rows=(await client.query("SELECT name AS value,'name' AS kind FROM prompt_library WHERE deleted_at IS NULL AND name ILIKE $1 UNION SELECT DISTINCT tag AS value,'tag' AS kind FROM prompt_library CROSS JOIN LATERAL unnest(tags) AS tag WHERE deleted_at IS NULL AND tag ILIKE $1 LIMIT 12", [`%${term}%`])).rows;
    return ok({items:rows});
  }
  if (pathname === '/api/prompts/search' && method === 'GET') {
    const keyword=(url.searchParams.get('keyword') || '').trim();
    const history=url.searchParams.get('history')==='true', regex=url.searchParams.get('regex')==='true';
    if (keyword.length>100) return fail('搜索词过长');
    if (regex && me.role!=='admin') return fail('仅管理员可使用正则搜索',403);
    if (regex && !safePattern(keyword)) return fail('正则搜索语法超出安全范围');
    if (!keyword) return ok({items:[]});
    const op=regex ? '~*' : 'ILIKE';
    const value=regex ? keyword : `%${keyword.replace(/[\\%_]/g,'\\$&')}%`;
    const versionSource=history ? 'JOIN prompt_library_versions v ON v.prompt_id=p.id' : 'JOIN LATERAL (SELECT * FROM prompt_library_versions WHERE prompt_id=p.id ORDER BY version DESC LIMIT 1) v ON true';
    if (regex) await client.query("SET LOCAL statement_timeout = '150ms'");
    const items=(await client.query(`SELECT p.id,p.name,p.owner_id,p.tags,p.folder_id,p.updated_at,v.id AS version_id,v.semver,v.content,v.prompt_type,v.format FROM prompt_library p ${versionSource} WHERE p.deleted_at IS NULL AND (p.name ${op} $1 OR v.content ${op} $1 OR array_to_string(p.tags,' ') ${op} $1) ORDER BY p.updated_at DESC,v.version DESC LIMIT 200`,[value])).rows;
    return ok({items});
  }
  const refsRoute=pathname.match(/^\/api\/prompts\/([^/]+)\/references$/);
  if (refsRoute && method === 'GET') {
    const outgoing=(await client.query('SELECT DISTINCT p.id,p.name,v.id AS version_id,v.semver FROM prompt_version_includes i JOIN prompt_library_versions v ON v.id=i.target_version_id JOIN prompt_library p ON p.id=v.prompt_id WHERE i.source_version_id IN (SELECT id FROM prompt_library_versions WHERE prompt_id=$1)',[refsRoute[1]])).rows;
    const incoming=(await client.query('SELECT DISTINCT p.id,p.name,v.id AS version_id,v.semver FROM prompt_version_includes i JOIN prompt_library_versions v ON v.id=i.source_version_id JOIN prompt_library p ON p.id=v.prompt_id WHERE i.target_version_id IN (SELECT id FROM prompt_library_versions WHERE prompt_id=$1)',[refsRoute[1]])).rows;
    const experiments=(await client.query("SELECT id,title FROM experiments WHERE prompt_version_id IN (SELECT id FROM prompt_library_versions WHERE prompt_id=$1) AND record_kind='definition'",[refsRoute[1]])).rows;
    return ok({outgoing,incoming,experiments});
  }
  const previewRoute=pathname.match(/^\/api\/prompts\/([^/]+)\/versions\/([^/]+)\/preview$/);
  if (previewRoute && method === 'POST') {
    const body=await readBody();
    const version=(await client.query('SELECT * FROM prompt_library_versions WHERE id=$1 AND prompt_id=$2',[previewRoute[2],previewRoute[1]])).rows[0];
    if (!version) return fail('版本不存在',404);
    try { return ok(await renderPromptVersion(client,version,body.values || {})); } catch(error) { return fail(error.message); }
  }
  const analyticsRoute=pathname.match(/^\/api\/prompts\/([^/]+)\/analytics$/);
  if (analyticsRoute && method === 'GET') {
    const versions=(await client.query(`SELECT v.id,v.semver,count(u.run_id)::int AS calls,count(u.run_id) FILTER (WHERE r.status='completed')::int AS completed,
      avg(r.auto_score)::float AS average_auto_score,avg(h.average_rating)::float AS average_human_rating,
      COALESCE(sum(h.rating_count),0)::int AS human_count,avg(r.prompt_tokens)::float AS average_prompt_tokens
      FROM prompt_library_versions v LEFT JOIN prompt_run_uses u ON u.version_id=v.id LEFT JOIN experiment_runs r ON r.id=u.run_id
      LEFT JOIN LATERAL (SELECT avg(rating) AS average_rating,count(*)::int AS rating_count FROM experiment_annotations WHERE run_id=r.id) h ON true
      WHERE v.prompt_id=$1 GROUP BY v.id ORDER BY v.version DESC`,[analyticsRoute[1]])).rows;
    const trend=(await client.query("SELECT to_char(u.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS day,count(*)::int AS calls,avg(r.auto_score)::float AS average_auto_score FROM prompt_run_uses u JOIN experiment_runs r ON r.id=u.run_id JOIN prompt_library_versions v ON v.id=u.version_id WHERE v.prompt_id=$1 AND u.created_at>=now()-interval '30 days' GROUP BY day ORDER BY day",[analyticsRoute[1]])).rows;
    const models=(await client.query('SELECT DISTINCT r.api_model FROM prompt_run_uses u JOIN experiment_runs r ON r.id=u.run_id JOIN prompt_library_versions v ON v.id=u.version_id WHERE v.prompt_id=$1 ORDER BY r.api_model',[analyticsRoute[1]])).rows.map(row=>row.api_model);
    return ok({versions,trend,models});
  }
  if (pathname === '/api/prompts' && method === 'GET') {
    const folder = url.searchParams.get('folderId');
    const items = (await client.query(`SELECT p.id,p.name,p.owner_id,p.folder_id,p.tags,p.updated_at,v.id AS version_id,v.semver,v.content,v.prompt_type,v.format,s.average_auto_score,s.average_human_rating,s.calls
      FROM prompt_library p LEFT JOIN LATERAL (SELECT * FROM prompt_library_versions WHERE prompt_id=p.id ORDER BY version DESC LIMIT 1) v ON true
      LEFT JOIN LATERAL (SELECT avg(r.auto_score)::float AS average_auto_score,avg(h.average_rating)::float AS average_human_rating,count(u.run_id)::int AS calls
        FROM prompt_run_uses u JOIN experiment_runs r ON r.id=u.run_id LEFT JOIN LATERAL (SELECT avg(rating) AS average_rating FROM experiment_annotations WHERE run_id=r.id) h ON true WHERE u.version_id=v.id) s ON true
      WHERE p.deleted_at IS NULL AND ($1::text IS NULL OR p.folder_id=$1) ORDER BY p.updated_at DESC LIMIT 500`, [folder])).rows;
    return ok({ items });
  }
  if (pathname === '/api/prompts' && method === 'POST') {
    const body = await readBody();
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) return fail('名称为必填，最多 200 字');
    let tags, value;
    try { tags = validatedTags(body.tags || []); value = validatedVersion(body); } catch (error) { return fail(error.message); }
    if (body.folderId && !(await client.query('SELECT 1 FROM prompt_folders WHERE id=$1', [body.folderId])).rowCount) return fail('文件夹不存在', 404);
    let expanded;
    try { expanded=await expandIncludes(client,value); } catch(error) { return fail(error.message); }
    const checked = await compliance(client, { ...body, ...value }, me);
    if (checked) return checked;
    const promptId = id(), versionId = id();
    await client.query('INSERT INTO prompt_library(id,name,owner_id,folder_id,tags) VALUES($1,$2,$3,$4,$5)', [promptId,body.name.trim(),me.id,body.folderId || null,tags]);
    await client.query('INSERT INTO prompt_library_versions(id,prompt_id,version,semver,content,prompt_type,format,variables,messages,tool_schema,author_id,change_summary) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [versionId,promptId,'1.0.0',value.content,value.type,value.format,JSON.stringify(value.variables),JSON.stringify(value.messages),JSON.stringify(value.toolSchema),me.id,'初始版本']);
    for (const targetId of directIncludes(value)) await client.query('INSERT INTO prompt_version_includes(source_version_id,target_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[versionId,targetId]);
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
