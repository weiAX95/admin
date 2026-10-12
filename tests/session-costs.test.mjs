import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';

test('session costs use central model prices, preserve snapshots and disclose missing coverage', async t => {
  const server = await createPgTestServer(t);
  const login = async (username, password) => {
    const response = await fetch(`${server.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return (await response.json()).token;
  };
  const admin = await login('admin', 'admin123');
  const member = await login('member', 'test');
  const request = async (path, method = 'GET', token = admin, body) => {
    const response = await fetch(`${server.base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  assert.deepEqual((await request('/sessions/cost-stats?priceMode=current&granularity=day')).data, { totalUsd: null, pricedMessages: 0, unpricedMessages: 0, trend: [], byModel: [], sessions: [] });
  const model = await request('/experiment-platform/models', 'POST', admin, { name: 'chat:model-a', displayName: '聊天模型 A', apiModel: 'chat-model-a', provider: 'custom', capabilities: { input: ['text'], output: ['text'], tools: false }, mediaPricing: {}, inputUsdPerMillion: 1000, outputUsdPerMillion: 2000 });
  assert.equal(model.status, 201);
  const now = new Date().toISOString();
  const stored = await request('/sessions/ingest', 'POST', admin, { id: 'cost-session', userId: 'external', messages: [
    { id: 'question', role: 'user', content: '问题', at: now },
    { id: 'answer', role: 'assistant', content: '回答', at: now, usage: { model: 'chat:model-a', promptTokens: 1000, completionTokens: 500 } },
  ] });
  assert.equal(stored.status, 201);
  const initial = (await request('/sessions/cost-stats?priceMode=current&granularity=day')).data;
  assert.equal(initial.totalUsd, 2);
  assert.equal(initial.sessions[0].costUsd, 2);
  assert.equal(initial.trend.length, 1);
  assert.equal(initial.byModel[0].model, 'chat:model-a');
  assert.equal((await request('/sessions/cost-stats?priceMode=current&granularity=month')).data.trend[0].date.length, 7);
  assert.equal((await request('/sessions/cost-stats?priceMode=current&granularity=week')).data.trend[0].date.length, 10);
  assert.equal((await request('/sessions/cost-stats?priceMode=invalid')).status, 400);
  assert.equal((await request('/sessions/ingest', 'POST', admin, { id: 'cost-session', messages: stored.data.messages })).status, 200);
  assert.equal((await server.client.query("SELECT count(*)::int AS count FROM session_usage_prices WHERE session_id='cost-session'")).rows[0].count, 1);
  assert.equal((await request(`/sessions/model-prices/${model.data.id}`, 'PATCH', member, { inputUsdPer1K: 2, outputUsdPer1K: 4 })).status, 403);
  assert.equal((await request(`/sessions/model-prices/${model.data.id}`, 'PATCH', admin, { inputUsdPer1K: -1, outputUsdPer1K: 4 })).status, 422);
  assert.equal((await request(`/sessions/model-prices/${model.data.id}`, 'PATCH', admin, { inputUsdPer1K: 2, outputUsdPer1K: 4 })).status, 200);
  assert.equal((await request('/sessions/cost-stats?priceMode=current&granularity=day')).data.totalUsd, 4);
  assert.equal((await request('/sessions/cost-stats?priceMode=snapshot&granularity=day')).data.totalUsd, 2);
  await server.client.query('UPDATE experiment_models SET name=$2 WHERE id=$1', [model.data.id, 'chat:model-a-renamed']);
  assert.equal((await request('/sessions/cost-stats?priceMode=current&granularity=day')).data.totalUsd, 4);
  const unknown = await request('/sessions/ingest', 'POST', admin, { id: 'unknown-model', userId: 'external', messages: [
    { id: 'question', role: 'user', content: '未定价问题', at: now },
    { id: 'answer', role: 'assistant', content: '未定价回答', at: now, usage: { model: 'unknown-model', promptTokens: 100, completionTokens: 50 } },
  ] });
  assert.equal(unknown.status, 201);
  const partial = (await request('/sessions/cost-stats?priceMode=current&granularity=day')).data;
  assert.equal(partial.totalUsd, 4);
  assert.equal(partial.pricedMessages, 1);
  assert.equal(partial.unpricedMessages, 1);
  assert.equal(partial.sessions.find(item => item.id === 'unknown-model').costUsd, null);
  assert.equal(partial.sessions.find(item => item.id === 'cost-session').costUsd, 4);
  assert.equal((await request('/experiment-platform/models', 'POST', admin, { name: 'unknown-model', displayName: '后配置模型', apiModel: 'unknown-model', provider: 'custom', capabilities: { input: ['text'], output: ['text'], tools: false }, mediaPricing: {}, inputUsdPerMillion: 1000, outputUsdPerMillion: 1000 })).status, 201);
  const repriced = (await request('/sessions/cost-stats?priceMode=current&granularity=day')).data;
  assert.equal(repriced.totalUsd, 4.15);
  assert.equal(repriced.unpricedMessages, 0);
  const historic = (await request('/sessions/cost-stats?priceMode=snapshot&granularity=day')).data;
  assert.equal(historic.totalUsd, 2);
  assert.equal(historic.unpricedMessages, 1);
  assert.equal((await request('/sessions/ingest', 'POST', admin, { id: 'cost-session', messages: [{ id: 'missing-price', role: 'assistant', content: '补充回答', at: now, usage: { model: 'unregistered', promptTokens: 10, completionTokens: 10 } }] })).status, 200);
  const mixed = (await request('/sessions/cost-stats?priceMode=current&granularity=day')).data.sessions.find(item => item.id === 'cost-session');
  assert.equal(mixed.costUsd, null);
  assert.equal(mixed.knownCostUsd, 4);
  assert.equal(mixed.unpricedMessages, 1);
});
