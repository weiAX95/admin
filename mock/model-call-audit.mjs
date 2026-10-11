const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DELAY = [250, 1000, 4000];
const pending = new Set();

export function maskAuditPrompt(messages) {
  const text = (messages || []).flatMap(message => [message.content, ...(message.parts || []).filter(part => part.type === 'text').map(part => part.text)]).filter(value => typeof value === 'string').join('\n').slice(0, 1000);
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[身份证号]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[密钥]')
    .replace(/api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_-]+/gi, '[API Key]')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

export function enqueueModelCallAudit(pool, event) {
  const row = { ...event, promptPreview: maskAuditPrompt(event.messages) };
  delete row.messages;
  const work = (async () => {
    for (let attempt = 0; attempt <= DELAY.length; attempt++) {
      try {
        await pool.query(`INSERT INTO model_call_audit(request_id,run_id,phase,attempt,user_id,model_id,api_model,module,provider,prompt_preview,prompt_tokens,completion_tokens,latency_ms,status_code,succeeded,error_code)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT(request_id) DO NOTHING`, [row.requestId,row.runId,row.phase,row.attempt,row.userId,row.modelId,row.apiModel,row.module,row.provider,row.promptPreview,row.promptTokens,row.completionTokens,row.latencyMs,row.statusCode,row.succeeded,row.errorCode]);
        return;
      } catch {
        if (attempt === DELAY.length) { console.error('[model-call-audit] write failed after retries'); return; }
        await new Promise(resolve => setTimeout(resolve, DELAY[attempt]));
      }
    }
  })();
  pending.add(work);
  void work.finally(() => pending.delete(work));
}

export async function flushModelCallAudits() { await Promise.all([...pending]); }

export async function handleModelCallAudit({ pathname, method, client, me, url }) {
  if (pathname !== '/api/model-call-audit' || method !== 'GET') return null;
  if (me.role !== 'admin') return { status: 403, data: { error: '仅管理员可查看模型调用审计' } };
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  const modelId = url.searchParams.get('modelId') || '';
  const userId = url.searchParams.get('userId') || '';
  const module = url.searchParams.get('module') || '';
  const page = Number(url.searchParams.get('page') || 1);
  if ((start && (!DATE.test(start) || Number.isNaN(Date.parse(`${start}T00:00:00Z`)))) || (end && (!DATE.test(end) || Number.isNaN(Date.parse(`${end}T00:00:00Z`)))) || (start && end && start > end) || (module && !['experiments','evaluations','project_analysis'].includes(module)) || !Number.isSafeInteger(page) || page < 1 || page > 10000) return { status: 400, data: { error: '审计筛选条件无效' } };
  const params = [start,end,modelId,userId,module];
  const where = "($1::text='' OR a.created_at >= $1::date) AND ($2::text='' OR a.created_at < $2::date + interval '1 day') AND ($3::text='' OR a.model_id=$3) AND ($4::text='' OR a.user_id=$4) AND ($5::text='' OR a.module=$5)";
  const total = Number((await client.query(`SELECT count(*)::bigint AS n FROM model_call_audit a WHERE ${where}`, params)).rows[0].n);
  const rows = (await client.query(`SELECT a.*,COALESCE(m.display_name,a.api_model) AS model_name,COALESCE(u.name,u.username,a.user_id,'已删除账号') AS user_name
    FROM model_call_audit a LEFT JOIN experiment_models m ON m.id=a.model_id LEFT JOIN users u ON u.id=a.user_id
    WHERE ${where} ORDER BY a.created_at DESC,a.request_id DESC LIMIT 100 OFFSET $6`, [...params,(page-1)*100])).rows;
  return { status: 200, data: { total, page, pageSize: 100, items: rows.map(row => ({ requestId: row.request_id, runId: row.run_id, phase: row.phase, attempt: row.attempt, userId: row.user_id, userName: row.user_name, modelId: row.model_id, modelName: row.model_name, module: row.module, provider: row.provider, promptPreview: row.prompt_preview, promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, latencyMs: row.latency_ms, statusCode: row.status_code, succeeded: row.succeeded, errorCode: row.error_code, createdAt: row.created_at })) } };
}
