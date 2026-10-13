import crypto from 'node:crypto';

const METRICS = new Set([
  'session_daily_tokens','session_refusal_streak','session_negative_rate',
  'model_5xx_rate','model_p50_ms','model_p95_ms','model_p99_ms','model_qps',
  'evaluation_pass_rate','evaluation_average_score',
  'governance_daily_cost_usd','governance_budget_used_percent',
]);
const OPERATORS = new Set(['>','<','=','>=','<=']);
const LEVELS = new Set(['info','warning','critical']);
const CHANNELS = new Set(['in_app','email']);

function validateRule(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const metric = body?.metric;
  const scopeType = typeof metric === 'string' && metric.startsWith('model_') ? 'model' : 'global';
  const scopeId = scopeType === 'model' ? String(body?.scopeId || '*') : '*';
  const threshold = body?.threshold;
  const durationSeconds = body?.durationSeconds ?? 0;
  const channels = body?.channels ?? ['in_app'];
  if (!name || name.length > 120 || !METRICS.has(metric) || !OPERATORS.has(body?.operator)
    || typeof threshold !== 'number' || !Number.isFinite(threshold) || !Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 86400
    || !LEVELS.has(body?.level) || !scopeId || (body?.enabled !== undefined && typeof body.enabled !== 'boolean') || !Array.isArray(channels)
    || new Set(channels).size !== channels.length || channels.some(channel => !CHANNELS.has(channel))) {
    return { error: '请填写有效的名称、指标、比较符、阈值、持续秒数、级别和通知渠道' };
  }
  return { name, metric, scopeType, scopeId, operator: body.operator, threshold, durationSeconds, level: body.level, channels, enabled: Boolean(body.enabled) };
}

async function prepareImport(client, body) {
  if (body?.schemaVersion !== 1 || !Array.isArray(body.rules) || body.rules.length < 1 || body.rules.length > 200 || !['skip','replace'].includes(body.mode)) {
    return { error: '导入文件须为版本 1，包含 1–200 条规则，并选择跳过或覆盖同名规则' };
  }
  const existing = (await client.query('SELECT id,name,template_key,version FROM alert_rules')).rows;
  const names = new Set();
  const rows = [];
  for (const [index, raw] of body.rules.entries()) {
    const value = validateRule(raw);
    let error = value.error || null;
    const templateKey = raw?.templateKey ?? null;
    if (!error && templateKey !== null && (typeof templateKey !== 'string' || !templateKey)) error = '内置模板标识无效';
    if (!error && names.has(value.name)) error = '文件中规则名称重复';
    if (!error) names.add(value.name);
    const target = templateKey ? existing.find(item => item.template_key === templateKey) : existing.find(item => item.name === value.name);
    if (!error && templateKey && !target) error = '内置模板不存在';
    if (!error && target && ((templateKey && target.template_key !== templateKey) || (!templateKey && target.template_key))) error = '规则名称与内置模板冲突';
    if (!error && existing.some(item => item.name === value.name && item.id !== target?.id)) error = '规则名称已被其他规则使用';
    if (!error && value.scopeType === 'model' && value.scopeId !== '*'
      && !(await client.query('SELECT 1 FROM experiment_models WHERE id=$1', [value.scopeId])).rowCount) error = '模型不存在';
    rows.push({ index, name: raw?.name || '', value, status: error ? 'error' : target ? body.mode === 'skip' ? 'skip' : 'update' : 'create', error, targetId: target?.id || null, version: target?.version || null });
  }
  return { rows };
}

async function closeRuleIncidents(client, ruleId) {
  await client.query("UPDATE alert_incidents SET status='resolved',resolved_at=now(),resolution_note='规则已修改或停用' WHERE rule_id=$1 AND status IN ('firing','acknowledged')", [ruleId]);
  await client.query('DELETE FROM alert_rule_state WHERE rule_id=$1', [ruleId]);
}

export async function handleAlertRules({ pathname, method, client, me, readBody, url }) {
  if (!pathname.startsWith('/api/alerts/rules') && !pathname.startsWith('/api/alerts/incidents')) return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可管理告警' } };
  if (pathname === '/api/alerts/rules' && method === 'GET') {
    const items = (await client.query('SELECT * FROM alert_rules ORDER BY template_key NULLS LAST,name')).rows;
    return { status: 200, data: { items } };
  }
  if (pathname === '/api/alerts/rules/import/preview' && method === 'POST') {
    const prepared = await prepareImport(client, await readBody());
    if (prepared.error) return { status: 400, data: { error: prepared.error } };
    return { status: 200, data: { rows: prepared.rows.map(({ value, ...row }) => row) } };
  }
  if (pathname === '/api/alerts/rules/import' && method === 'POST') {
    const body = await readBody();
    await client.query('SELECT pg_advisory_xact_lock(748211)');
    const prepared = await prepareImport(client, body);
    if (prepared.error) return { status: 400, data: { error: prepared.error } };
    if (prepared.rows.some(row => row.error)) return { status: 400, data: { error: '导入文件有无效规则', rows: prepared.rows.map(({ value, ...row }) => row) } };
    const expected = body.expected;
    if (!Array.isArray(expected) || expected.length !== prepared.rows.length || prepared.rows.some((row, index) => expected[index]?.status !== row.status || expected[index]?.targetId !== row.targetId || expected[index]?.version !== row.version)) {
      return { status: 409, data: { error: '规则在预览后发生变化，请重新预览' } };
    }
    const counts = { created: 0, updated: 0, skipped: 0 };
    for (const row of prepared.rows) {
      if (row.status === 'skip') { counts.skipped++; continue; }
      const value = row.value;
      if (row.status === 'create') {
        await client.query(`INSERT INTO alert_rules
          (id,name,metric,scope_type,scope_id,operator,threshold,duration_seconds,level,channels,enabled,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [crypto.randomUUID(),value.name,value.metric,value.scopeType,value.scopeId,value.operator,value.threshold,value.durationSeconds,value.level,value.channels,value.enabled,me.id]);
        counts.created++;
      } else {
        await closeRuleIncidents(client,row.targetId);
        await client.query(`UPDATE alert_rules SET name=$2,metric=$3,scope_type=$4,scope_id=$5,operator=$6,
          threshold=$7,duration_seconds=$8,level=$9,channels=$10,enabled=$11,version=version+1,updated_at=now()
          WHERE id=$1`, [row.targetId,value.name,value.metric,value.scopeType,value.scopeId,value.operator,value.threshold,value.durationSeconds,value.level,value.channels,value.enabled]);
        counts.updated++;
      }
    }
    return { status: 200, data: counts };
  }
  if (pathname === '/api/alerts/rules' && method === 'POST') {
    const value = validateRule(await readBody());
    if (value.error) return { status: 400, data: { error: value.error } };
    await client.query('SELECT pg_advisory_xact_lock(748211)');
    const duplicate = await client.query('SELECT 1 FROM alert_rules WHERE name=$1', [value.name]);
    if (duplicate.rowCount) return { status: 409, data: { error: '同名告警规则已存在' } };
    if (value.scopeType === 'model' && value.scopeId !== '*' && !(await client.query('SELECT 1 FROM experiment_models WHERE id=$1', [value.scopeId])).rowCount) return { status: 400, data: { error: '模型不存在' } };
    const item = (await client.query(`INSERT INTO alert_rules
      (id,name,metric,scope_type,scope_id,operator,threshold,duration_seconds,level,channels,enabled,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [crypto.randomUUID(),value.name,value.metric,value.scopeType,value.scopeId,value.operator,value.threshold,value.durationSeconds,value.level,value.channels,value.enabled,me.id])).rows[0];
    return { status: 201, data: { item } };
  }
  const match = pathname.match(/^\/api\/alerts\/rules\/([^/]+)$/);
  if (match && ['PUT','DELETE'].includes(method)) {
    await client.query('SELECT pg_advisory_xact_lock(748211)');
    const existing = (await client.query('SELECT * FROM alert_rules WHERE id=$1 FOR UPDATE', [match[1]])).rows[0];
    if (!existing) return { status: 404, data: { error: '规则不存在' } };
    const body = await readBody();
    if (!Number.isSafeInteger(body?.version) || body.version !== existing.version) return { status: 409, data: { error: '规则已被修改，请刷新后重试' } };
    if (method === 'DELETE') {
      if (existing.template_key) return { status: 400, data: { error: '内置规则只能停用' } };
      await closeRuleIncidents(client, existing.id);
      await client.query('DELETE FROM alert_rules WHERE id=$1', [existing.id]);
      return { status: 200, data: { deleted: true } };
    }
    const value = validateRule({ ...existing, scopeId: existing.scope_id, durationSeconds: existing.duration_seconds, ...body });
    if (value.error) return { status: 400, data: { error: value.error } };
    if (value.scopeType === 'model' && value.scopeId !== '*' && !(await client.query('SELECT 1 FROM experiment_models WHERE id=$1', [value.scopeId])).rowCount) return { status: 400, data: { error: '模型不存在' } };
    const duplicate = await client.query('SELECT 1 FROM alert_rules WHERE name=$1 AND id<>$2', [value.name, existing.id]);
    if (duplicate.rowCount) return { status: 409, data: { error: '同名告警规则已存在' } };
    await closeRuleIncidents(client, existing.id);
    const item = (await client.query(`UPDATE alert_rules SET name=$2,metric=$3,scope_type=$4,scope_id=$5,
      operator=$6,threshold=$7,duration_seconds=$8,level=$9,channels=$10,enabled=$11,
      version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
    [existing.id,value.name,value.metric,value.scopeType,value.scopeId,value.operator,value.threshold,value.durationSeconds,value.level,value.channels,value.enabled])).rows[0];
    return { status: 200, data: { item } };
  }
  if (pathname === '/api/alerts/incidents' && method === 'GET') {
    const status = url.searchParams.get('status');
    const level = url.searchParams.get('level');
    if (status && !['firing','acknowledged','resolved'].includes(status)) return { status: 400, data: { error: '无效状态' } };
    if (level && !LEVELS.has(level)) return { status: 400, data: { error: '无效级别' } };
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get('limit')) || 50)));
    const items = (await client.query(`SELECT * FROM alert_incidents
      WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR level=$2)
      ORDER BY opened_at DESC LIMIT $3`, [status, level, limit])).rows;
    return { status: 200, data: { items } };
  }
  const ack = pathname.match(/^\/api\/alerts\/incidents\/([^/]+)\/ack$/);
  if (ack && method === 'POST') {
    const item = (await client.query(`UPDATE alert_incidents SET status='acknowledged',acknowledged_by=$2,acknowledged_at=now()
      WHERE id=$1 AND status='firing' RETURNING *`, [ack[1],me.id])).rows[0];
    if (!item) return { status: 409, data: { error: '告警已确认、已解决或不存在' } };
    return { status: 200, data: { item } };
  }
  return { status: 405, data: { error: '不支持该操作' } };
}

function breaches(value, operator, threshold) {
  if (operator === '>') return value > threshold;
  if (operator === '<') return value < threshold;
  if (operator === '=') return value === threshold;
  if (operator === '>=') return value >= threshold;
  return value <= threshold;
}

async function notifyIncident(client, rule, incident, value) {
  if (rule.level === 'info' || !rule.channels.length) return;
  const admins = (await client.query("SELECT id,review_email,review_email_enabled FROM users WHERE role='admin' AND status='active'")).rows;
  for (const admin of admins) {
    const email = rule.channels.includes('email') && admin.review_email_enabled ? admin.review_email : null;
    await client.query(`INSERT INTO app_notifications
      (id,user_id,kind,entity_id,title,body,target_url,email_to,email_status,email_next_attempt_at)
      VALUES($1,$2,'alert_rule',$3,$4,$5,'/alerts',$6,$7,$8)
      ON CONFLICT(user_id,kind,entity_id) DO NOTHING`,
    [crypto.randomUUID(),admin.id,incident.id,`告警：${rule.name}`,`${rule.metric} / ${incident.scope_id} 当前值 ${value}，阈值 ${rule.operator} ${rule.threshold}。`,email,email?'pending':'skipped',email?new Date():null]);
  }
}

export async function evaluateAlertRules(pool, now = new Date()) {
  const client = await pool.connect();
  let opened = 0;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(748210)');
    const rules = (await client.query('SELECT * FROM alert_rules WHERE enabled=true ORDER BY id')).rows;
    for (const rule of rules) {
      const samples = (await client.query(`SELECT DISTINCT ON (scope_id) scope_id,sampled_at,value
        FROM alert_metric_samples WHERE metric=$1 AND scope_type=$2
          AND ($3='*' OR scope_id=$3) AND sampled_at BETWEEN $4::timestamptz - interval '2 minutes' AND $4
        ORDER BY scope_id,sampled_at DESC`, [rule.metric,rule.scope_type,rule.scope_id,now])).rows;
      for (const sample of samples) {
        const state = (await client.query('SELECT * FROM alert_rule_state WHERE rule_id=$1 AND scope_id=$2 FOR UPDATE', [rule.id,sample.scope_id])).rows[0];
        if (state && Date.parse(state.last_sample_at) >= Date.parse(sample.sampled_at)) continue;
        const breached = breaches(Number(sample.value),rule.operator,Number(rule.threshold));
        const priorRecent = state && Date.parse(sample.sampled_at)-Date.parse(state.last_sample_at) <= 2 * 60_000;
        const first = breached ? priorRecent && state.first_breached_at ? state.first_breached_at : sample.sampled_at : null;
        await client.query(`INSERT INTO alert_rule_state(rule_id,scope_id,first_breached_at,last_sample_at)
          VALUES($1,$2,$3,$4) ON CONFLICT(rule_id,scope_id) DO UPDATE
          SET first_breached_at=EXCLUDED.first_breached_at,last_sample_at=EXCLUDED.last_sample_at`,
        [rule.id,sample.scope_id,first,sample.sampled_at]);
        const active = (await client.query("SELECT id FROM alert_incidents WHERE rule_id=$1 AND scope_id=$2 AND status IN ('firing','acknowledged') FOR UPDATE", [rule.id,sample.scope_id])).rows[0];
        if (!breached) {
          if (active) await client.query("UPDATE alert_incidents SET status='resolved',resolved_at=$2,resolution_note='指标恢复正常' WHERE id=$1", [active.id,sample.sampled_at]);
          continue;
        }
        if (active) { await client.query('UPDATE alert_incidents SET trigger_value=$2,trigger_count=trigger_count+1 WHERE id=$1', [active.id,sample.value]); continue; }
        if (Date.parse(sample.sampled_at)-Date.parse(first) < rule.duration_seconds * 1000) continue;
        const incident = (await client.query(`INSERT INTO alert_incidents
          (id,rule_id,rule_name,metric,scope_id,level,trigger_value,opened_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [crypto.randomUUID(),rule.id,rule.name,rule.metric,sample.scope_id,rule.level,sample.value,sample.sampled_at])).rows[0];
        await notifyIncident(client,rule,incident,sample.value);
        opened++;
      }
    }
    await client.query('COMMIT');
    return opened;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
