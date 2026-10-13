import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createPgTestServer } from './pg-helper.mjs';

test('measure global search against 10,000 versioned cases and 8,000 other records', async t => {
  const { base, client } = await createPgTestServer(t);
  await client.query("INSERT INTO experiment_datasets(id,name,owner_id) VALUES('bench-dataset','性能测试集','admin')");
  await client.query("INSERT INTO experiment_dataset_versions(id,dataset_id,version) VALUES('bench-version','bench-dataset',1)");
  await client.query("INSERT INTO experiment_dataset_cases(id,dataset_version_id,case_key,variables,input_payload) SELECT 'bench-case-'||i,'bench-version','bench-'||i,'{}'::jsonb,to_jsonb('benchmark needle case '||i) FROM generate_series(1,10000) i");
  await client.query("INSERT INTO tasks(id,title,status,owner_id) SELECT 'bench-task-'||i,'benchmark needle task '||i,'todo','admin' FROM generate_series(1,2000) i");
  await client.query("INSERT INTO notes(id,title,content) SELECT 'bench-note-'||i,'benchmark needle note '||i,'body' FROM generate_series(1,2000) i");
  await client.query("INSERT INTO experiments(id,title,owner_id) SELECT 'bench-experiment-'||i,'benchmark needle experiment '||i,'admin' FROM generate_series(1,2000) i");
  await client.query("INSERT INTO sessions(id,external_user_id) SELECT 'bench-session-'||i,'chat-user' FROM generate_series(1,1000) i");
  await client.query("INSERT INTO session_messages(session_id,id,role,content,at,item_order) SELECT 'bench-session-'||i,'bench-message-'||i,'user','benchmark needle session '||i,now(),0 FROM generate_series(1,1000) i");
  await client.query("INSERT INTO prompt_library(id,name,owner_id) SELECT 'bench-prompt-'||i,'benchmark needle prompt '||i,'admin' FROM generate_series(1,1000) i");
  await client.query("INSERT INTO prompt_library_versions(id,prompt_id,version,semver,content) SELECT 'bench-prompt-version-'||i,'bench-prompt-'||i,1,'1.0.0','body' FROM generate_series(1,1000) i");
  await client.query('ANALYZE');
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const times = [];
  for (let index = 0; index < 30; index++) {
    const started = performance.now();
    const response = await fetch(`${base}/search?query=needle`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.items.length > 0);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  const p95 = Math.round(times[28]);
  console.log(`Global search: 10,000 cases + 8,000 other records; 30 HTTP requests; median=${Math.round(times[14])}ms p95=${p95}ms max=${Math.round(times[29])}ms`);
  assert.ok(p95 < 300, `p95 ${p95}ms exceeds 300ms`);
});
