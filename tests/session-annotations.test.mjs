import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createPgTestServer } from "./pg-helper.mjs";
import { importJson } from "../mock/postgres-store.mjs";

test("session ingest and annotations survive upsert, account removal and restart", async t => {
  const server = await createPgTestServer(t);
  const request = async (path, method = "GET", token = "", body) => {
    const response = await fetch(`${server.base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const admin = (await request("/auth/login", "POST", "", { username: "admin", password: "admin123" })).data.token;
  const member = (await request("/auth/login", "POST", "", { username: "member", password: "test" })).data.token;
  assert.equal((await server.client.query("SELECT token_hash FROM auth_sessions WHERE user_id='admin'")).rows[0].token_hash.length, 64);
  const created = await request("/sessions/ingest", "POST", admin, { id: "review-session", userId: "external-web-user", messages: [
    { role: "user", content: "解释这段代码", at: "2026-10-06T00:00:00Z" },
    { role: "assistant", content: "```js\nconst answer = 42;\n```", at: "2026-10-06T00:00:01Z" },
  ] });
  assert.equal(created.status, 201);
  const [userMessage, assistant] = created.data.messages;
  assert.ok(userMessage.id && assistant.id);
  assert.equal((await request(`/sessions/review-session/messages/${userMessage.id}/annotation`, "POST", admin, { rating: 5, tags: [] })).status, 422);
  assert.equal((await request(`/sessions/review-session/messages/${assistant.id}/annotation`, "POST", admin, { rating: 0, tags: [] })).status, 422);
  assert.equal((await request(`/sessions/review-session/messages/${assistant.id}/annotation`, "POST", admin, { rating: 4, tags: ["准确", "过于冗长"] })).status, 200);
  const candidates = await request('/evaluation/candidates', 'GET', admin);
  assert.equal(candidates.data.items.length, 1);
  assert.equal(candidates.data.items[0].source_type, 'session');
  assert.equal((await request('/evaluation/candidates?source=experiment', 'GET', admin)).data.items.length, 0);
  assert.equal((await request('/evaluation/candidates/qa-summary', 'GET', member)).status, 403);
  assert.deepEqual((await request('/evaluation/candidates/qa-summary', 'GET', admin)).data, { pending: 1, accepted: 0, rejected: 0, reviewed: 0, approvalRate: null });
  const targetDataset = await request('/experiment-datasets', 'POST', admin, { name: '反馈闭环', cases: [{ caseKey: 'seed', input: '已有问题' }] });
  const staged = await request(`/evaluation/candidates/${candidates.data.items[0].id}/review`, 'POST', admin, { status: 'staged', datasetId: targetDataset.data.id, input: '审核后的问题', expectedOutput: '审核后的答案' });
  assert.equal(staged.status, 200);
  assert.equal((await request('/evaluation/candidates/qa-export', 'GET', member)).status, 403);
  let qaExport = await request('/evaluation/candidates/qa-export', 'GET', admin);
  assert.equal(qaExport.data.count, 1);
  assert.deepEqual(JSON.parse(qaExport.data.content.trim()), { caseKey: `candidate-${candidates.data.items[0].id}`, input: '审核后的问题', expectedOutput: '审核后的答案', context: [], tags: ['准确', '过于冗长'], difficulty: 3, source: 'session_extract' });
  assert.deepEqual((await request('/evaluation/candidates/qa-summary', 'GET', admin)).data, { pending: 0, accepted: 1, rejected: 0, reviewed: 1, approvalRate: 1 });
  const published = await request('/evaluation/candidates/publish', 'POST', admin, { datasetId: targetDataset.data.id });
  assert.equal(published.data.published, 1);
  const newVersion = await request(`/experiment-dataset-versions/${published.data.versionId}`, 'GET', admin);
  assert.equal(newVersion.data.cases.length, 2);
  assert.ok(newVersion.data.cases.some(item => item.source === 'session_extract'));
  qaExport = await request('/evaluation/candidates/qa-export', 'GET', admin);
  assert.equal(qaExport.data.count, 1);
  assert.equal((await request(`/sessions/review-session/messages/${assistant.id}/annotation`, "POST", member, { rating: 2, tags: ["准确", "不准确"] })).status, 200);
  let detail = (await request("/sessions/review-session", "GET", admin)).data;
  assert.equal(detail.userId, "external-web-user");
  assert.deepEqual([detail.messages[1].annotation.summary.averageRating, detail.messages[1].annotation.summary.ratingCount], [3, 2]);
  assert.ok(detail.messages[1].annotation.summary.tags.some(item => item.tag === "准确" && item.count === 2));
  assert.equal(detail.messages[1].annotation.mine.rating, 4);
  await Promise.all([4, 5].map(rating => request(`/sessions/review-session/messages/${assistant.id}/annotation`, "POST", admin, { rating, tags: ["幻觉"] })));
  await request(`/sessions/review-session/messages/${assistant.id}/annotation`, "POST", admin, { rating: 5, tags: ["幻觉"] });
  qaExport = await request('/evaluation/candidates/qa-export', 'GET', admin);
  assert.equal(JSON.parse(qaExport.data.content.trim()).input, '审核后的问题');
  assert.equal(JSON.parse(qaExport.data.content.trim()).expectedOutput, '审核后的答案');
  await request(`/sessions/review-session/messages/${assistant.id}/annotation`, 'POST', admin, { rating: 2, tags: [] });
  assert.equal((await request('/evaluation/candidates/qa-export', 'GET', admin)).data.count, 0);
  await request(`/sessions/review-session/messages/${assistant.id}/annotation`, 'POST', admin, { rating: 5, tags: ['幻觉'] });
  assert.equal(JSON.parse((await request('/evaluation/candidates/qa-export', 'GET', admin)).data.content.trim()).input, '审核后的问题');
  detail = (await request("/sessions/review-session", "GET", admin)).data;
  assert.equal(detail.messages[1].annotation.summary.ratingCount, 2);
  assert.equal(detail.messages[1].annotation.summary.averageRating, 3.5);

  const duplicate = await request("/sessions/ingest", "POST", admin, { id: "review-session", messages: [created.data.messages[0], created.data.messages[0]] });
  assert.equal(duplicate.status, 409);
  const modified = await request("/sessions/ingest", "POST", admin, { id: "review-session", messages: [{ ...assistant, content: "偷偷改写" }] });
  assert.equal(modified.status, 409);
  const merged = await request("/sessions/ingest", "POST", admin, { id: "review-session", messages: [assistant, { id: "new-msg", role: "assistant", content: "补充", at: "2026-10-06T00:00:02Z" }] });
  assert.equal(merged.status, 200);
  assert.equal(merged.data.messages.length, 3);
  assert.equal((await request("/sessions/review-session", "GET", admin)).data.messages[1].annotation.summary.ratingCount, 2);

  assert.equal((await request("/users/member", "DELETE", admin)).status, 200);
  detail = (await request("/sessions/review-session", "GET", admin)).data;
  assert.equal(detail.messages[1].annotation.summary.ratingCount, 2);
  assert.equal((await server.client.query("SELECT count(*)::int AS count FROM message_annotations WHERE reviewer_id IS NULL")).rows[0].count, 1);
  assert.equal((await request("/auth/me", "GET", member)).status, 401);

  const exited = once(server.child, "exit");
  server.child.kill("SIGTERM");
  await exited;
  const restarted = spawn(process.execPath, [new URL("../mock/server.mjs", import.meta.url).pathname], { cwd: new URL("../", import.meta.url).pathname, env: { ...process.env, DATABASE_URL: server.url, MOCK_PORT: String(server.port) }, stdio: "ignore" });
  t.after(() => restarted.kill("SIGTERM"));
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const result = await request("/auth/me", "GET", admin); if (result.status === 200) { ready = true; break; } }
    catch { /* restarting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true);
  assert.equal((await request("/sessions/review-session", "GET", admin)).data.messages[1].annotation.summary.ratingCount, 2);
  assert.equal((await request("/auth/logout", "POST", admin, {})).status, 200);
  assert.equal((await request("/auth/me", "GET", admin)).status, 401);
});

test("legacy importer rejects a second import without modifying data", async t => {
  const { client } = await createPgTestServer(t);
  const before = (await client.query("SELECT count(*)::int AS count FROM tasks")).rows[0].count;
  await assert.rejects(importJson(client, { tasks: [], users: [] }, "duplicate"), /不为空/);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM tasks")).rows[0].count, before);
});

test('QA export includes every approved session candidate across pages and excludes unapproved feedback', async t => {
  const server = await createPgTestServer(t);
  const login = await fetch(`${server.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const get = async path => {
    const response = await fetch(`${server.base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, data: await response.json() };
  };
  await server.client.query(`INSERT INTO evaluation_candidates(id,source_type,source_annotation_id,source_entity_id,rating,input_payload,expected_payload,status)
    SELECT 'qa-'||n,'session','annotation-'||n,'session-'||n,5,to_jsonb('问题'||n),to_jsonb('答案'||n),'staged' FROM generate_series(1,51) n`);
  await server.client.query(`INSERT INTO evaluation_candidates(id,source_type,source_annotation_id,source_entity_id,rating,input_payload,expected_payload,status) VALUES
    ('rejected-qa','session','rejected-annotation','other',5,'"丢弃"','"丢弃"','rejected'),
    ('low-qa','session','low-annotation','other',2,'"低分"','"低分"','published'),
    ('experiment-qa','experiment','experiment-annotation','other',5,'"实验"','"实验"','staged')`);
  assert.equal((await get('/evaluation/candidates?source=session&status=staged')).data.items.length, 50);
  assert.equal((await get('/evaluation/candidates?source=session&status=staged&page=2')).data.items.length, 1);
  const exported = await get('/evaluation/candidates/qa-export');
  assert.equal(exported.status, 200);
  assert.equal(exported.data.count, 51);
  const pairs = exported.data.content.trim().split('\n').map(JSON.parse);
  assert.equal(new Set(pairs.map(pair => pair.caseKey)).size, 51);
  assert.ok(pairs.every(pair => pair.source === 'session_extract'));
  assert.deepEqual((await get('/evaluation/candidates/qa-summary')).data, { pending: 0, accepted: 51, rejected: 1, reviewed: 52, approvalRate: 51 / 52 });
});
