import { shanghaiDate } from './note-reviews.mjs';

const ok = (data, status = 200) => ({ status, data });
const fail = (error, status = 400) => ok({ error }, status);
const money = value => Number(value.toFixed(12));

export async function saveSessionPriceSnapshot(client, sessionId, message) {
  if (!message.usage) return;
  const model = message.usage.model
    ? (await client.query('SELECT id,input_usd_per_million,output_usd_per_million FROM experiment_models WHERE name=$1', [message.usage.model])).rows[0]
    : null;
  await client.query(`INSERT INTO session_usage_prices(session_id,message_id,model_id,input_price_snapshot,output_price_snapshot)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,message_id) DO NOTHING`,
  [sessionId, message.id, model?.id || null, model?.input_usd_per_million ?? null, model?.output_usd_per_million ?? null]);
}

function bucketDate(day, granularity) {
  if (granularity === 'day') return day;
  if (granularity === 'month') return day.slice(0, 7);
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export async function handleSessionCosts({ pathname, method, client, me, url, readBody, sessions }) {
  if (pathname === '/api/sessions/model-prices' && method === 'GET') {
    if (me.role !== 'admin') return fail('仅管理员可配置会话模型价格', 403);
    const rows = (await client.query('SELECT id,name,display_name,input_usd_per_million,output_usd_per_million,status FROM experiment_models ORDER BY name')).rows;
    return ok({ items: rows.map(row => ({ id: row.id, name: row.name, displayName: row.display_name, inputUsdPer1K: row.input_usd_per_million / 1000, outputUsdPer1K: row.output_usd_per_million / 1000, status: row.status })) });
  }
  const priceRoute = pathname.match(/^\/api\/sessions\/model-prices\/([^/]+)$/);
  if (priceRoute && method === 'PATCH') {
    if (me.role !== 'admin') return fail('仅管理员可配置会话模型价格', 403);
    const body = await readBody();
    if (![body.inputUsdPer1K, body.outputUsdPer1K].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 100000)) return fail('模型输入与输出价格须为非负有限数', 422);
    const row = (await client.query('UPDATE experiment_models SET input_usd_per_million=$2,output_usd_per_million=$3 WHERE id=$1 RETURNING id,name,input_usd_per_million,output_usd_per_million', [priceRoute[1], body.inputUsdPer1K * 1000, body.outputUsdPer1K * 1000])).rows[0];
    if (!row) return fail('模型不存在', 404);
    await client.query("INSERT INTO security_audit_logs(actor_id,action,target_type,target_id) VALUES($1,'update_session_model_price','experiment_model',$2)", [me.id, row.id]);
    return ok({ id: row.id, name: row.name, inputUsdPer1K: row.input_usd_per_million / 1000, outputUsdPer1K: row.output_usd_per_million / 1000 });
  }
  if (pathname !== '/api/sessions/cost-stats' || method !== 'GET') return null;
  const priceMode = url.searchParams.get('priceMode') || 'current';
  const granularity = url.searchParams.get('granularity') || 'day';
  if (!['current','snapshot'].includes(priceMode) || !['day','week','month'].includes(granularity)) return fail('价格模式或时间粒度无效');
  const rows = (await client.query(`SELECT m.session_id,m.at,m.prompt_tokens,m.completion_tokens,m.usage_model,
    p.input_price_snapshot,p.output_price_snapshot,
    current_price.input_usd_per_million AS current_input_price,current_price.output_usd_per_million AS current_output_price
    FROM session_messages m
    LEFT JOIN session_usage_prices p ON p.session_id=m.session_id AND p.message_id=m.id
    LEFT JOIN LATERAL (SELECT id,input_usd_per_million,output_usd_per_million FROM experiment_models
      WHERE id=p.model_id OR name=m.usage_model ORDER BY (id=p.model_id) DESC LIMIT 1) current_price ON true
    WHERE m.prompt_tokens IS NOT NULL ORDER BY m.session_id,m.item_order`)).rows;
  const perSession = new Map(sessions.map(session => [session.id, { id: session.id, title: (session.messages.find(item => item.role === 'user')?.content || '（无标题）').slice(0, 40), knownCostUsd: 0, pricedMessages: 0, unpricedMessages: 0 }]));
  const trend = new Map(), byModel = new Map();
  let pricedMessages = 0, unpricedMessages = 0, totalUsd = 0;
  for (const row of rows) {
    const item = perSession.get(row.session_id);
    const inputPrice = priceMode === 'current' ? row.current_input_price : row.input_price_snapshot;
    const outputPrice = priceMode === 'current' ? row.current_output_price : row.output_price_snapshot;
    if (inputPrice === null || outputPrice === null) {
      unpricedMessages++;
      if (item) item.unpricedMessages++;
      continue;
    }
    const cost = money((row.prompt_tokens * inputPrice + row.completion_tokens * outputPrice) / 1_000_000);
    pricedMessages++;
    totalUsd += cost;
    if (item) { item.pricedMessages++; item.knownCostUsd += cost; }
    const date = bucketDate(shanghaiDate(row.at), granularity);
    trend.set(date, (trend.get(date) || 0) + cost);
    const model = row.usage_model || '未标明模型';
    byModel.set(model, (byModel.get(model) || 0) + cost);
  }
  return ok({ totalUsd: pricedMessages ? money(totalUsd) : null, pricedMessages, unpricedMessages,
    trend: [...trend].sort(([left], [right]) => left.localeCompare(right)).map(([date, costUsd]) => ({ date, costUsd: money(costUsd) })),
    byModel: [...byModel].sort((a, b) => b[1] - a[1]).map(([model, costUsd]) => ({ model, costUsd: money(costUsd) })),
    sessions: [...perSession.values()].map(item => ({ ...item, knownCostUsd: item.pricedMessages ? money(item.knownCostUsd) : null, costUsd: item.pricedMessages && !item.unpricedMessages ? money(item.knownCostUsd) : null })),
  });
}
