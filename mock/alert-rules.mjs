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
  const repeatMinutes = body?.repeatMinutes ?? 30;
  const channels = body?.channels ?? ['in_app'];
  const tags = body?.tags ?? [];
  if (!name || name.length > 120 || !METRICS.has(metric) || !OPERATORS.has(body?.operator)
    || typeof threshold !== 'number' || !Number.isFinite(threshold) || !Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 86400
    || !Number.isInteger(repeatMinutes) || repeatMinutes < 1 || repeatMinutes > 1440
    || !LEVELS.has(body?.level) || !scopeId || (body?.enabled !== undefined && typeof body.enabled !== 'boolean') || !Array.isArray(channels)
    || new Set(channels).size !== channels.length || channels.some(channel => !CHANNELS.has(channel))
    || !Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 32)) {
    return { error: '请填写有效的名称、指标、比较符、阈值、持续秒数、级别和通知渠道' };
  }
  return { name, metric, scopeType, scopeId, operator: body.operator, threshold, durationSeconds, repeatMinutes, level: body.level, channels, tags: [...new Set(tags.map(tag => tag.trim()))], enabled: Boolean(body.enabled) };
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
  const closed = (await client.query("UPDATE alert_incidents SET status='resolved',resolved_at=now(),resolution_note='规则已修改或停用' WHERE rule_id=$1 AND status IN ('firing','acknowledged') RETURNING id,resolved_at", [ruleId])).rows;
  for (const item of closed) await recordIncidentEvent(client,item.id,'resolved',null,'规则已修改或停用',item.resolved_at);
  await client.query('DELETE FROM alert_rule_state WHERE rule_id=$1', [ruleId]);
}

async function recordIncidentEvent(client, incidentId, eventType, actorId = null, detail = null, occurredAt = new Date()) {
  await client.query(`INSERT INTO alert_incident_events(id,incident_id,actor_id,event_type,detail,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6)`, [crypto.randomUUID(),incidentId,actorId,eventType,detail,occurredAt]);
}

function validateSilence(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const scopeType = body?.scopeType;
  const scopeValue = scopeType === 'all' ? null : typeof body?.scopeValue === 'string' ? body.scopeValue.trim() : '';
  const timezone = body?.timezone || 'Asia/Shanghai';
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); }
  catch { return { error: '无效时区' }; }
  if (!name || name.length > 120 || !['all','module','tag'].includes(scopeType)
    || (scopeType === 'module' && !['session','model','evaluation','governance'].includes(scopeValue))
    || (scopeType === 'tag' && (!scopeValue || scopeValue.length > 32))
    || !Number.isInteger(body?.startMinute) || body.startMinute < 0 || body.startMinute > 1439
    || !Number.isInteger(body?.endMinute) || body.endMinute < 0 || body.endMinute > 1439
    || body.startMinute === body.endMinute || typeof body?.enabled !== 'boolean') {
    return { error: '请填写有效的静默名称、范围和每日起止时间' };
  }
  return { name, scopeType, scopeValue, timezone, startMinute: body.startMinute, endMinute: body.endMinute, enabled: body.enabled };
}

async function isSilenced(client, rule, at) {
  if (rule.level !== 'warning') return false;
  const silences = (await client.query('SELECT * FROM alert_silences WHERE enabled=true')).rows;
  return silences.some(silence => {
    const module = rule.metric.split('_')[0];
    if (silence.scope_type === 'module' && silence.scope_value !== module) return false;
    if (silence.scope_type === 'tag' && !(rule.tags || []).includes(silence.scope_value)) return false;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: silence.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at).map(part => [part.type,part.value]));
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    return silence.start_minute < silence.end_minute
      ? minute >= silence.start_minute && minute < silence.end_minute
      : minute >= silence.start_minute || minute < silence.end_minute;
  });
}

export async function handleAlertRules({ pathname, method, client, me, readBody, url }) {
  if (!pathname.startsWith('/api/alerts/rules') && !pathname.startsWith('/api/alerts/incidents') && !pathname.startsWith('/api/alerts/silences')) return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可管理告警' } };
  if (pathname === '/api/alerts/silences' && method === 'GET') {
    return { status: 200, data: { items: (await client.query('SELECT * FROM alert_silences ORDER BY name,id')).rows } };
  }
  if (pathname === '/api/alerts/silences' && method === 'POST') {
    const value = validateSilence(await readBody());
    if (value.error) return { status: 400, data: { error: value.error } };
    const item = (await client.query(`INSERT INTO alert_silences
      (id,name,scope_type,scope_value,timezone,start_minute,end_minute,enabled,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [crypto.randomUUID(),value.name,value.scopeType,value.scopeValue,value.timezone,value.startMinute,value.endMinute,value.enabled,me.id])).rows[0];
    return { status: 201, data: { item } };
  }
  const silencePath = pathname.match(/^\/api\/alerts\/silences\/([^/]+)$/);
  if (silencePath && ['PUT','DELETE'].includes(method)) {
    const existing = (await client.query('SELECT * FROM alert_silences WHERE id=$1 FOR UPDATE', [silencePath[1]])).rows[0];
    if (!existing) return { status: 404, data: { error: '静默规则不存在' } };
    const body = await readBody();
    if (!Number.isSafeInteger(body?.version) || body.version !== existing.version) return { status: 409, data: { error: '静默规则已变更，请刷新重试' } };
    if (method === 'DELETE') {
      await client.query('DELETE FROM alert_silences WHERE id=$1', [existing.id]);
      return { status: 200, data: { deleted: true } };
    }
    const value = validateSilence(body);
    if (value.error) return { status: 400, data: { error: value.error } };
    const item = (await client.query(`UPDATE alert_silences SET name=$2,scope_type=$3,scope_value=$4,
      timezone=$5,start_minute=$6,end_minute=$7,enabled=$8,version=version+1,updated_at=now()
      WHERE id=$1 RETURNING *`, [existing.id,value.name,value.scopeType,value.scopeValue,value.timezone,value.startMinute,value.endMinute,value.enabled])).rows[0];
    return { status: 200, data: { item } };
  }
  if (pathname === '/api/alerts/rules' && method === 'GET') {
    const items = (await client.query('SELECT * FROM alert_rules ORDER BY template_key NULLS LAST,name')).rows;
    return { status: 200, data: { items } };
  }
  if (pathname === '/api/alerts/rules/preview' && method === 'POST') {
    const value = validateRule(await readBody());
    if (value.error) return { status: 400, data: { error: value.error } };
    if (value.scopeType === 'model' && value.scopeId !== '*'
      && !(await client.query('SELECT 1 FROM experiment_models WHERE id=$1', [value.scopeId])).rowCount) return { status: 400, data: { error: '模型不存在' } };
    const lower = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    let cursorScope = null, cursorAt = null, sampleCount = 0, firstSampleAt = null, lastSampleAt = null;
    let triggers = 0, firstTriggerAt = null;
    const days = new Map(), states = new Map();
    while (true) {
      const rows = (await client.query(`SELECT scope_id,sampled_at,value FROM alert_metric_samples
        WHERE metric=$1 AND scope_type=$2 AND ($3='*' OR scope_id=$3) AND sampled_at >= $4
          AND ($5::text IS NULL OR (scope_id,sampled_at)>($5,$6::timestamptz))
        ORDER BY scope_id,sampled_at LIMIT 5000`,
      [value.metric,value.scopeType,value.scopeId,lower,cursorScope,cursorAt])).rows;
      for (const row of rows) {
        const at = new Date(row.sampled_at).getTime();
        const prior = states.get(row.scope_id);
        const breached = breaches(Number(row.value),value.operator,value.threshold);
        const firstAt = breached ? prior?.firstAt !== null && prior?.firstAt !== undefined && at-prior.lastAt <= 120_000 ? prior.firstAt : at : null;
        let active = Boolean(breached && prior?.active && at-prior.lastAt <= 120_000);
        if (breached && !active && at-firstAt >= value.durationSeconds * 1000) {
          active = true; triggers++;
          if (!firstTriggerAt || at < new Date(firstTriggerAt).getTime()) firstTriggerAt = row.sampled_at;
          const day = shanghaiDay(row.sampled_at);
          days.set(day,(days.get(day)||0)+1);
        }
        states.set(row.scope_id,{ firstAt, lastAt: at, active });
        sampleCount++;
        if (!firstSampleAt || at < new Date(firstSampleAt).getTime()) firstSampleAt = row.sampled_at;
        if (!lastSampleAt || at > new Date(lastSampleAt).getTime()) lastSampleAt = row.sampled_at;
      }
      if (rows.length < 5000) break;
      cursorScope = rows.at(-1).scope_id; cursorAt = rows.at(-1).sampled_at;
    }
    return { status: 200, data: { triggers, firstTriggerAt, sampleCount, firstSampleAt, lastSampleAt,
      byDay: [...days].sort(([left],[right]) => left.localeCompare(right)).map(([day,count]) => ({ day,count })),
      historyComplete: Boolean(firstSampleAt && new Date(firstSampleAt).getTime() <= lower.getTime() + 120_000) } };
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
          (id,name,metric,scope_type,scope_id,operator,threshold,duration_seconds,repeat_minutes,level,channels,tags,enabled,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [crypto.randomUUID(),value.name,value.metric,value.scopeType,value.scopeId,value.operator,value.threshold,value.durationSeconds,value.repeatMinutes,value.level,value.channels,value.tags,value.enabled,me.id]);
        counts.created++;
      } else {
        await closeRuleIncidents(client,row.targetId);
        await client.query(`UPDATE alert_rules SET name=$2,metric=$3,scope_type=$4,scope_id=$5,operator=$6,
          threshold=$7,duration_seconds=$8,repeat_minutes=$9,level=$10,channels=$11,tags=$12,enabled=$13,version=version+1,updated_at=now()
          WHERE id=$1`, [row.targetId,value.name,value.metric,value.scopeType,value.scopeId,value.operator,value.threshold,value.durationSeconds,value.repeatMinutes,value.level,value.channels,value.tags,value.enabled]);
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
      (id,name,metric,scope_type,scope_id,operator,threshold,duration_seconds,repeat_minutes,level,channels,tags,enabled,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [crypto.randomUUID(),value.name,value.metric,value.scopeType,value.scopeId,value.operator,value.threshold,value.durationSeconds,value.repeatMinutes,value.level,value.channels,value.tags,value.enabled,me.id])).rows[0];
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
    const value = validateRule({ ...existing, scopeId: existing.scope_id, durationSeconds: existing.duration_seconds, repeatMinutes: existing.repeat_minutes, ...body });
    if (value.error) return { status: 400, data: { error: value.error } };
    if (value.scopeType === 'model' && value.scopeId !== '*' && !(await client.query('SELECT 1 FROM experiment_models WHERE id=$1', [value.scopeId])).rowCount) return { status: 400, data: { error: '模型不存在' } };
    const duplicate = await client.query('SELECT 1 FROM alert_rules WHERE name=$1 AND id<>$2', [value.name, existing.id]);
    if (duplicate.rowCount) return { status: 409, data: { error: '同名告警规则已存在' } };
    await closeRuleIncidents(client, existing.id);
    const item = (await client.query(`UPDATE alert_rules SET name=$2,metric=$3,scope_type=$4,scope_id=$5,
      operator=$6,threshold=$7,duration_seconds=$8,repeat_minutes=$9,level=$10,channels=$11,tags=$12,enabled=$13,
      version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
    [existing.id,value.name,value.metric,value.scopeType,value.scopeId,value.operator,value.threshold,value.durationSeconds,value.repeatMinutes,value.level,value.channels,value.tags,value.enabled])).rows[0];
    return { status: 200, data: { item } };
  }
  if (pathname === '/api/alerts/incidents' && method === 'GET') {
    const status = url.searchParams.get('status');
    const level = url.searchParams.get('level');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (status && !['firing','acknowledged','resolved'].includes(status)) return { status: 400, data: { error: '无效状态' } };
    if (level && !LEVELS.has(level)) return { status: 400, data: { error: '无效级别' } };
    if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to))) || (from && to && Date.parse(from) > Date.parse(to))) return { status: 400, data: { error: '无效时间范围' } };
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(url.searchParams.get('limit')) || 50)));
    const offset = Math.min(100000, Math.max(0, Math.trunc(Number(url.searchParams.get('offset')) || 0)));
    const items = (await client.query(`SELECT * FROM alert_incidents
      WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR level=$2)
        AND ($3::timestamptz IS NULL OR opened_at >= $3) AND ($4::timestamptz IS NULL OR opened_at <= $4)
      ORDER BY opened_at DESC,id DESC LIMIT $5 OFFSET $6`, [status, level, from, to, limit, offset])).rows;
    const total = Number((await client.query(`SELECT count(*) AS count FROM alert_incidents
      WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR level=$2)
        AND ($3::timestamptz IS NULL OR opened_at >= $3) AND ($4::timestamptz IS NULL OR opened_at <= $4)`, [status,level,from,to])).rows[0].count);
    return { status: 200, data: { items, total } };
  }
  if (pathname === '/api/alerts/incidents/analytics' && method === 'GET') {
    const days = Number(url.searchParams.get('days') || 30);
    const level = url.searchParams.get('level');
    if (![7,30,90].includes(days) || (level && !LEVELS.has(level))) return { status: 400, data: { error: '无效统计范围' } };
    const where = "opened_at >= now() - $1 * interval '1 day' AND ($2::text IS NULL OR level=$2)";
    const params = [days,level];
    const totals = (await client.query(`SELECT count(*)::integer AS total,
      round(avg(extract(epoch from acknowledged_at-opened_at)/60)::numeric,2) AS mtta_minutes,
      round(avg(extract(epoch from resolved_at-opened_at)/60)::numeric,2) AS mttr_minutes
      FROM alert_incidents WHERE ${where}`, params)).rows[0];
    const daily = (await client.query(`SELECT (opened_at AT TIME ZONE 'Asia/Shanghai')::date::text AS day,
      count(*) FILTER (WHERE level='info')::integer AS info,
      count(*) FILTER (WHERE level='warning')::integer AS warning,
      count(*) FILTER (WHERE level='critical')::integer AS critical
      FROM alert_incidents WHERE ${where} GROUP BY day ORDER BY day`, params)).rows;
    const byModule = (await client.query(`SELECT split_part(metric,'_',1) AS name,count(*)::integer AS count
      FROM alert_incidents WHERE ${where} GROUP BY name ORDER BY count DESC,name`, params)).rows;
    const byType = (await client.query(`SELECT metric AS name,count(*)::integer AS count
      FROM alert_incidents WHERE ${where} GROUP BY metric ORDER BY count DESC,metric`, params)).rows;
    const byLevel = (await client.query(`SELECT level,count(*)::integer AS total,
      round(avg(extract(epoch from acknowledged_at-opened_at)/60)::numeric,2) AS mtta_minutes,
      round(avg(extract(epoch from resolved_at-opened_at)/60)::numeric,2) AS mttr_minutes
      FROM alert_incidents WHERE ${where} GROUP BY level ORDER BY level`, params)).rows;
    return { status: 200, data: { totals, daily, byModule, byType, byLevel } };
  }
  const history = pathname.match(/^\/api\/alerts\/incidents\/([^/]+)\/events$/);
  if (history && method === 'GET') {
    if (!(await client.query('SELECT 1 FROM alert_incidents WHERE id=$1', [history[1]])).rowCount) return { status: 404, data: { error: '告警不存在' } };
    const items = (await client.query(`SELECT event.*,u.name AS actor_name FROM alert_incident_events event
      LEFT JOIN users u ON u.id=event.actor_id WHERE event.incident_id=$1
      ORDER BY event.occurred_at,event.id`, [history[1]])).rows;
    return { status: 200, data: { items } };
  }
  const ack = pathname.match(/^\/api\/alerts\/incidents\/([^/]+)\/ack$/);
  if (ack && method === 'POST') {
    const item = (await client.query(`UPDATE alert_incidents SET status='acknowledged',acknowledged_by=$2,acknowledged_at=now()
      WHERE id=$1 AND status='firing' RETURNING *`, [ack[1],me.id])).rows[0];
    if (!item) return { status: 409, data: { error: '告警已确认、已解决或不存在' } };
    await recordIncidentEvent(client,item.id,'acknowledged',me.id,null,item.acknowledged_at);
    return { status: 200, data: { item } };
  }
  const action = pathname.match(/^\/api\/alerts\/incidents\/([^/]+)\/(assign|notes|resolve)$/);
  if (action && method === 'POST') {
    const item = (await client.query('SELECT * FROM alert_incidents WHERE id=$1 FOR UPDATE', [action[1]])).rows[0];
    if (!item) return { status: 404, data: { error: '告警不存在' } };
    const body = await readBody();
    if (action[2] === 'assign') {
      if (item.status === 'resolved') return { status: 409, data: { error: '已解决的告警不可指派' } };
      const assigneeId = body?.userId;
      if (typeof assigneeId !== 'string' || !(await client.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [assigneeId])).rowCount) return { status: 400, data: { error: '请选择有效的在职处理人' } };
      if (item.assigned_to === assigneeId) return { status: 200, data: { item } };
      const updated = (await client.query('UPDATE alert_incidents SET assigned_to=$2 WHERE id=$1 RETURNING *', [item.id,assigneeId])).rows[0];
      await recordIncidentEvent(client,item.id,'assigned',me.id,assigneeId);
      return { status: 200, data: { item: updated } };
    }
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (!note || note.length > 2000) return { status: 400, data: { error: '请填写不超过 2000 字的处置说明' } };
    if (action[2] === 'notes') {
      await recordIncidentEvent(client,item.id,'note',me.id,note);
      return { status: 201, data: { saved: true } };
    }
    if (item.status === 'resolved') return { status: 409, data: { error: '告警已解决' } };
    const updated = (await client.query("UPDATE alert_incidents SET status='resolved',resolved_at=now(),resolution_note=$2 WHERE id=$1 RETURNING *", [item.id,note])).rows[0];
    await recordIncidentEvent(client,item.id,'resolved',me.id,note,updated.resolved_at);
    return { status: 200, data: { item: updated } };
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

function shanghaiDay(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(value).map(part => [part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function notifyIncident(client, rule, incident, value) {
  if (rule.level === 'info' || !rule.channels.length) return;
  if (await isSilenced(client,rule,incident.opened_at)) return;
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

async function notifyEscalation(client, incident) {
  const admins = (await client.query("SELECT id,review_email,review_email_enabled FROM users WHERE role='admin' AND status='active'")).rows;
  for (const admin of admins) {
    const email = admin.review_email_enabled ? admin.review_email : null;
    await client.query(`INSERT INTO app_notifications
      (id,user_id,kind,entity_id,title,body,target_url,email_to,email_status,email_next_attempt_at)
      VALUES($1,$2,'alert_rule_escalation',$3,$4,$5,'/alerts',$6,$7,$8)
      ON CONFLICT(user_id,kind,entity_id) DO NOTHING`,
    [crypto.randomUUID(),admin.id,incident.id,`严重告警：${incident.rule_name}`,`告警持续超过 30 分钟仍未确认，已升级为 Critical。当前值 ${incident.trigger_value}。`,email,email?'pending':'skipped',email?new Date():null]);
  }
}

async function notifyReminder(client, incident) {
  if (await isSilenced(client,incident,incident.last_reminded_at)) return;
  const admins = (await client.query("SELECT id,review_email,review_email_enabled FROM users WHERE role='admin' AND status='active'")).rows;
  const reminderKey = `${incident.id}:reminder:${new Date(incident.last_reminded_at).getTime()}`;
  for (const admin of admins) {
    const email = incident.channels.includes('email') && admin.review_email_enabled ? admin.review_email : null;
    if (!incident.channels.includes('in_app') && !email) continue;
    await client.query(`INSERT INTO app_notifications
      (id,user_id,kind,entity_id,title,body,target_url,email_to,email_status,email_next_attempt_at)
      VALUES($1,$2,'alert_rule_reminder',$3,$4,$5,'/alerts',$6,$7,$8)
      ON CONFLICT(user_id,kind,entity_id) DO NOTHING`,
    [crypto.randomUUID(),admin.id,reminderKey,`待确认告警：${incident.rule_name}`,`${incident.metric} / ${incident.scope_id} 当前值 ${incident.trigger_value}，请确认并处置。`,email,email?'pending':'skipped',email?new Date():null]);
  }
}

export async function evaluateAlertRules(pool, now = new Date()) {
  const client = await pool.connect();
  let changed = 0;
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
        let active = (await client.query("SELECT id FROM alert_incidents WHERE rule_id=$1 AND scope_id=$2 AND status IN ('firing','acknowledged') FOR UPDATE", [rule.id,sample.scope_id])).rows[0];
        if (active && !priorRecent) {
          await client.query("UPDATE alert_incidents SET status='resolved',resolved_at=$2,resolution_note='采样中断，重新计时' WHERE id=$1", [active.id,sample.sampled_at]);
          await recordIncidentEvent(client,active.id,'resolved',null,'采样中断，重新计时',sample.sampled_at);
          changed++;
          active = null;
        }
        if (!breached) {
          if (active) {
            await client.query("UPDATE alert_incidents SET status='resolved',resolved_at=$2,resolution_note='指标恢复正常' WHERE id=$1", [active.id,sample.sampled_at]);
            await recordIncidentEvent(client,active.id,'resolved',null,'指标恢复正常',sample.sampled_at);
            changed++;
          }
          continue;
        }
        if (active) { await client.query('UPDATE alert_incidents SET trigger_value=$2,trigger_count=trigger_count+1 WHERE id=$1', [active.id,sample.value]); continue; }
        if (Date.parse(sample.sampled_at)-Date.parse(first) < rule.duration_seconds * 1000) continue;
        const incident = (await client.query(`INSERT INTO alert_incidents
          (id,rule_id,rule_name,metric,scope_id,level,trigger_value,opened_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [crypto.randomUUID(),rule.id,rule.name,rule.metric,sample.scope_id,rule.level,sample.value,sample.sampled_at])).rows[0];
        await recordIncidentEvent(client,incident.id,'opened',null,null,sample.sampled_at);
        await notifyIncident(client,rule,incident,sample.value);
        changed++;
      }
    }
    const escalated = (await client.query(`UPDATE alert_incidents SET level='critical',escalated_at=$1,last_reminded_at=$1
      WHERE status='firing' AND level='warning' AND escalated_at IS NULL
        AND opened_at <= $1::timestamptz - interval '30 minutes' RETURNING *`, [now])).rows;
    for (const incident of escalated) {
      await recordIncidentEvent(client,incident.id,'escalated',null,'30 分钟未确认，升级为 Critical',incident.escalated_at);
      await notifyEscalation(client,incident);
    }
    changed += escalated.length;
    const reminders = (await client.query(`UPDATE alert_incidents incident SET last_reminded_at=$1
      FROM alert_rules rule WHERE incident.rule_id=rule.id AND rule.enabled=true
        AND incident.status='firing' AND incident.level<>'info'
        AND coalesce(incident.last_reminded_at,incident.opened_at) <= $1::timestamptz - rule.repeat_minutes * interval '1 minute'
      RETURNING incident.*,rule.channels,rule.tags`, [now])).rows;
    for (const incident of reminders) {
      await recordIncidentEvent(client,incident.id,'reminded',null,'未确认告警重复提醒',incident.last_reminded_at);
      await notifyReminder(client,incident);
    }
    changed += reminders.length;
    await client.query('COMMIT');
    return changed;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
