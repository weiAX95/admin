import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';

async function login(base, username, password) {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}
async function search(base, token, term) {
  const response = await fetch(`${base}/search?query=${encodeURIComponent(term)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: response.status, body: await response.json() };
}

test('global search groups six record types and preserves task/session permissions', async t => {
  const { base, client } = await createPgTestServer(t);
  const now = new Date().toISOString();
  await client.query("UPDATE tasks SET title='needle 管理任务' WHERE id='seed-task-1'");
  await client.query("INSERT INTO tasks(id,title,status,owner_id,created_at,updated_at) VALUES('member-task','needle 成员任务','todo','member',$1,$1)", [now]);
  await client.query("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES('search-note','needle 笔记','正文',$1,$1)", [now]);
  await client.query("INSERT INTO experiments(id,title,owner_id,created_at,updated_at) VALUES('search-experiment','needle 实验','member',$1,$1)", [now]);
  await client.query("INSERT INTO sessions(id,external_user_id,created_at,updated_at,ingested_by) VALUES('search-session','chat-user',$1,$1,'member'),('hidden-session','chat-user',$1,$1,'admin')", [now]);
  await client.query("INSERT INTO session_messages(session_id,id,role,content,at,item_order) VALUES('search-session','message-1','user','needle 会话',$1,0),('hidden-session','message-2','user','needle 私有会话',$1,0)", [now]);
  await client.query("INSERT INTO prompt_library(id,name,owner_id) VALUES('search-prompt','needle 提示词','member')");
  await client.query("INSERT INTO prompt_library_versions(id,prompt_id,version,semver,content) VALUES('search-prompt-version','search-prompt',1,'1.0.0','内容')");
  await client.query("INSERT INTO experiment_datasets(id,name,owner_id) VALUES('search-dataset','测试集','member')");
  await client.query("INSERT INTO experiment_dataset_versions(id,dataset_id,version) VALUES('search-version','search-dataset',1)");
  await client.query("INSERT INTO experiment_dataset_cases(id,dataset_version_id,case_key,variables,input_payload) VALUES('search-case','search-version','needle-case','{}','\"输入\"')");
  const admin = await login(base, 'admin', 'admin123');
  const member = await login(base, 'member', 'test');
  const adminResults = await search(base, admin, 'needle');
  assert.equal(adminResults.status, 200);
  assert.deepEqual(new Set(adminResults.body.items.map(item => item.type)), new Set(['task', 'note', 'session', 'experiment', 'prompt', 'case']));
  assert.ok(adminResults.body.items.some(item => item.id === 'seed-task-1'));
  assert.ok(adminResults.body.items.some(item => item.id === 'hidden-session'));
  const memberResults = await search(base, member, 'needle');
  assert.equal(memberResults.status, 200);
  assert.ok(!memberResults.body.items.some(item => item.id === 'seed-task-1' || item.id === 'hidden-session'));
  assert.ok(memberResults.body.items.some(item => item.id === 'member-task'));
  assert.equal(memberResults.body.items.find(item => item.id === 'search-case').href, '/experiments/datasets?versionId=search-version&caseKey=needle-case');
  assert.equal(memberResults.body.items.find(item => item.id === 'search-session').href, '/sessions?sessionId=search-session');
  const linkedCase = await fetch(`${base}/experiment-dataset-versions/search-version/cases/needle-case`, { headers: { Authorization: `Bearer ${member}` } });
  assert.equal(linkedCase.status, 200);
  assert.equal((await linkedCase.json()).item.case_key, 'needle-case');
  const missingCase = await fetch(`${base}/experiment-dataset-versions/search-version/cases/missing`, { headers: { Authorization: `Bearer ${member}` } });
  assert.equal(missingCase.status, 404);
});

test('global search rejects invalid terms, escapes wildcards and excludes recycled records', async t => {
  const { base, client } = await createPgTestServer(t);
  const token = await login(base, 'admin', 'admin123');
  const now = new Date().toISOString();
  await client.query("INSERT INTO notes(id,title,created_at,updated_at) VALUES('wildcard-note','literal 100%_case',$1,$1),('other-note','literal 100XXcase',$1,$1),('deleted-note','literal 100%_deleted',$1,$1)", [now]);
  await client.query("UPDATE notes SET deleted_at=now() WHERE id='deleted-note'");
  const literal = await search(base, token, '%_');
  assert.equal(literal.status, 200);
  assert.deepEqual(literal.body.items.filter(item => item.type === 'note').map(item => item.id), ['wildcard-note']);
  assert.equal((await search(base, token, '')).status, 400);
  assert.equal((await search(base, token, 'x'.repeat(121))).status, 400);
  assert.equal((await search(base, null, 'literal')).status, 401);
});
