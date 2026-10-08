import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';
import { runRetentionCleanup } from '../mock/retention.mjs';

async function login(base, username, password) {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  return (await response.json()).token;
}
async function request(base, token, method, path, data) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, data: await response.json() };
}

test('retention policy validates permissions and daily cleanup preserves reviewed material', async t => {
  const { base, client } = await createPgTestServer(t);
  const worker = { connect: async () => ({ query: (...args) => client.query(...args), release() {} }) };
  const admin = await login(base, 'admin', 'admin123');
  const member = await login(base, 'member', 'test');
  const path = '/settings/retention';
  assert.equal((await request(base, member, 'GET', path)).status, 403);
  const initial = await request(base, admin, 'GET', path);
  assert.equal(initial.data.auditDays, 90);
  assert.equal(initial.data.sessionDays, 180);
  assert.equal(initial.data.recycleDays, 30);
  const changed = await request(base, admin, 'PUT', path, { ...initial.data, auditDays: 30, sessionDays: 7, cleanupLocalTime: '03:00' });
  assert.equal(changed.status, 200);
  assert.equal((await request(base, admin, 'PUT', path, { ...initial.data, auditDays: 90 })).status, 409);
  assert.equal((await request(base, admin, 'PUT', path, { ...changed.data, auditDays: 1 })).status, 400);
  await client.query("INSERT INTO sessions(id,external_user_id,created_at,updated_at) VALUES('old-session','chat-user','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z'),('new-session','chat-user','2029-12-31T00:00:00Z','2029-12-31T00:00:00Z')");
  await client.query("INSERT INTO notes(id,title,content,source_session_id,created_at,updated_at) VALUES('source-note','摘录','保留','old-session','2029-12-31T00:00:00Z','2029-12-31T00:00:00Z')");
  await client.query("INSERT INTO evaluation_candidates(id,source_type,source_annotation_id,source_entity_id,rating,input_payload,expected_payload,status) VALUES('pending-candidate','session','annotation-1','old-session',4,'{}','{}','pending'),('staged-candidate','session','annotation-2','old-session',4,'{}','{}','staged')");
  await client.query("INSERT INTO security_audit_logs(actor_id,action,target_type,created_at) VALUES('admin','old','test','2020-01-01'),('admin','new','test','2029-12-31')");
  const now = new Date('2030-01-01T20:00:00Z');
  const result = await runRetentionCleanup(worker, now);
  assert.deepEqual({ audit: result.auditDeleted, sessions: result.sessionsDeleted, candidates: result.candidatesDeleted }, { audit: 1, sessions: 1, candidates: 1 });
  assert.equal(await runRetentionCleanup(worker, now), null);
  assert.deepEqual((await client.query('SELECT id FROM sessions')).rows.map(row => row.id), ['new-session']);
  assert.equal((await client.query('SELECT source_session_id FROM notes WHERE id=$1', ['source-note'])).rows[0].source_session_id, 'old-session');
  assert.deepEqual((await client.query('SELECT id FROM evaluation_candidates')).rows.map(row => row.id), ['staged-candidate']);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM retention_cleanup_runs WHERE local_date=$1', [result.localDate])).rows[0].count, 1);
});
