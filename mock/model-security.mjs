import crypto from 'node:crypto';

const pii = [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, /(?<!\d)1[3-9]\d{9}(?!\d)/, /(?<!\d)\d{17}[\dXx](?!\d)/];
const jailbreak = [/ignore (all )?(previous|prior) instructions/i, /忽略(之前|以上|所有).{0,12}(指令|规则|限制)/, /(?:reveal|泄露|输出).{0,30}(system prompt|系统提示词|密钥)/i];
const includesTerm = (text, terms) => terms.some(term => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()));

export function scanModelText(text, policy, direction) {
  if (direction === 'input') {
    if (policy.inputPii && pii.some(pattern => pattern.test(text))) return 'pii';
    if (policy.inputJailbreak && jailbreak.some(pattern => pattern.test(text))) return 'jailbreak';
    if (includesTerm(text, policy.sensitiveWords || [])) return 'sensitive_word';
  } else {
    if (policy.outputPii && pii.some(pattern => pattern.test(text))) return 'pii';
    if (includesTerm(text, policy.brandTerms || [])) return 'brand_risk';
  }
  return null;
}

const publicPolicy = row => ({ modelId: row.model_id, inputPii: row.input_pii, inputJailbreak: row.input_jailbreak, outputPii: row.output_pii, sensitiveWords: row.sensitive_words, brandTerms: row.brand_terms, version: row.version });
const defaultPolicy = modelId => ({ modelId, inputPii: false, inputJailbreak: false, outputPii: false, sensitiveWords: [], brandTerms: [], version: 0 });
export async function getModelSecurityPolicy(client, modelId) {
  const row = (await client.query('SELECT * FROM model_security_policies WHERE model_id=$1', [modelId])).rows[0];
  return row ? publicPolicy(row) : defaultPolicy(modelId);
}

export async function recordModelSecurityEvent(client, audit, direction, rule) {
  await client.query('INSERT INTO model_security_events(id,model_id,run_id,phase,direction,rule,action) VALUES($1,$2,$3,$4,$5,$6,$7)', [crypto.randomUUID(),audit.modelId,audit.runId || null,audit.phase || 'main',direction,rule,direction === 'input' ? 'blocked' : 'replaced']);
}

export async function handleModelSecurity({ pathname, method, client, me, readBody }) {
  if (pathname === '/api/model-security-events' && method === 'GET') {
    if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可查看安全事件' } };
    const rows = (await client.query(`SELECT e.id,e.model_id,e.run_id,e.phase,e.direction,e.rule,e.action,e.created_at,m.display_name
      FROM model_security_events e LEFT JOIN experiment_models m ON m.id=e.model_id ORDER BY e.created_at DESC,e.id DESC LIMIT 100`)).rows;
    return { status: 200, data: { items: rows.map(row => ({ id: row.id, modelId: row.model_id, modelName: row.display_name || row.model_id, runId: row.run_id, phase: row.phase, direction: row.direction, rule: row.rule, action: row.action, createdAt: row.created_at })) } };
  }
  const match = pathname.match(/^\/api\/model-security\/([^/]+)$/);
  if (!match || !['GET','PUT'].includes(method)) return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可管理模型安全策略' } };
  const modelId = decodeURIComponent(match[1]);
  if (!(await client.query('SELECT 1 FROM experiment_models WHERE id=$1', [modelId])).rowCount) return { status: 404, data: { error: '模型不存在' } };
  if (method === 'GET') return { status: 200, data: await getModelSecurityPolicy(client, modelId) };
  const body = await readBody();
  const termsValid = value => Array.isArray(value) && value.length <= 20 && value.every(item => typeof item === 'string' && item.trim().length >= 2 && item.trim().length <= 100);
  if (!body || !['inputPii','inputJailbreak','outputPii'].every(key => typeof body[key] === 'boolean') || !termsValid(body.sensitiveWords) || !termsValid(body.brandTerms) || !Number.isSafeInteger(body.version) || body.version < 0) return { status: 400, data: { error: '安全策略参数无效' } };
  const values = [modelId,body.inputPii,body.inputJailbreak,body.outputPii,[...new Set(body.sensitiveWords.map(word => word.trim()))],[...new Set(body.brandTerms.map(word => word.trim()))]];
  const changed = body.version === 0 ? await client.query(`INSERT INTO model_security_policies(model_id,input_pii,input_jailbreak,output_pii,sensitive_words,brand_terms) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,values)
    : await client.query(`UPDATE model_security_policies SET input_pii=$2,input_jailbreak=$3,output_pii=$4,sensitive_words=$5,brand_terms=$6,version=version+1,updated_at=now() WHERE model_id=$1 AND version=$7 RETURNING *`,[...values,body.version]);
  if (!changed.rowCount) return { status: 409, data: { error: '安全策略已被其他管理员更新，请刷新后重试' } };
  return { status: 200, data: publicPolicy(changed.rows[0]) };
}
