import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createPgTestServer } from './pg-helper.mjs';

test('measure 1,100-session search over local PostgreSQL', async t => {
  const { base, client } = await createPgTestServer(t);
  const at = new Date().toISOString();
  await client.query("INSERT INTO sessions(id,external_user_id,created_at,updated_at) SELECT 'benchmark-'||i,'chat-user',$1,$1 FROM generate_series(1,1100) i", [at]);
  await client.query("INSERT INTO session_messages(session_id,id,role,content,at,item_order) SELECT 'benchmark-'||i,'message-'||j,CASE WHEN j%2=0 THEN 'assistant' ELSE 'user' END,'benchmark 关键词 '||i||' 第 '||j||' 条',$1,j FROM generate_series(1,1100) i CROSS JOIN generate_series(1,10) j", [at]);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const measure = async regex => {
    const times = [];
    for (let index = 0; index < 30; index++) {
      const started = performance.now();
      const response = await fetch(`${base}/sessions/search?query=benchmark&regex=${regex}`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.items.length, 20);
      assert.equal(payload.hasMore, true);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    return { medianMs: Math.round(times[14]), p95Ms: Math.round(times[28]), maxMs: Math.round(times[29]) };
  };
  const plain = await measure(false);
  const regex = await measure(true);
  console.log(`1,100 sessions / 11,000 messages, 30 requests each, local PostgreSQL: plain ${JSON.stringify(plain)}, regex ${JSON.stringify(regex)}`);
  assert.ok(plain.p95Ms < 1000, `plain p95 ${plain.p95Ms} ms`);
  assert.ok(regex.p95Ms < 1000, `regex p95 ${regex.p95Ms} ms`);
});
