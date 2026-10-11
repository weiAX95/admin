import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createPgTestServer } from './pg-helper.mjs';

test('measure 50-session JSON export on local PostgreSQL', async t => {
  const { base, client } = await createPgTestServer(t);
  const at = new Date().toISOString();
  await client.query("INSERT INTO sessions(id,external_user_id,created_at,updated_at) SELECT 'export-benchmark-'||i,'chat-user',$1,$1 FROM generate_series(1,50) i", [at]);
  await client.query("INSERT INTO session_messages(session_id,id,role,content,at,item_order) SELECT 'export-benchmark-'||i,'message-'||j,CASE WHEN j%2=0 THEN 'assistant' ELSE 'user' END,repeat('中文会话记录 ',20),$1,j FROM generate_series(1,50) i CROSS JOIN generate_series(1,20) j", [at]);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const ids = Array.from({ length: 50 }, (_, i) => `export-benchmark-${i + 1}`);
  const durations = [];
  let bytes = 0;
  for (let run = 0; run < 10; run++) {
    const started = performance.now();
    const response = await fetch(`${base}/sessions/export`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, format: 'json' }) });
    assert.equal(response.status, 200);
    const content = await response.text();
    const result = JSON.parse(content);
    assert.equal(result.sessions.length, 50);
    assert.equal(result.sessions.reduce((sum, session) => sum + session.messages.length, 0), 1000);
    bytes = Buffer.byteLength(content);
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  console.log(`50 sessions / 1,000 messages / ${bytes} bytes, local PostgreSQL, 10 requests: median ${Math.round(durations[4])} ms, p95 ${Math.round(durations[9])} ms`);
  assert.ok(durations[9] < 3000, `export took ${Math.round(durations[9])} ms`);
});
