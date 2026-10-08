import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';

async function login(base, username, password) {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}
async function call(base, token, path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}

test('global settings are versioned, public brand is limited, and new login TTL changes without changing old sessions', async t => {
  const { base, client } = await createPgTestServer(t);
  const oldToken = await login(base, 'admin', 'admin123');
  const oldHash = (await client.query('SELECT token_hash,expires_at FROM auth_sessions')).rows[0];
  const initial = await call(base, oldToken, '/settings/global');
  assert.equal(initial.body.sessionHours, 24);
  const saved = await call(base, oldToken, '/settings/global', 'PUT', { version: initial.body.version, systemName: '测试空间', sessionHours: 48, defaultPageSize: 50, defaultLanguage: 'en-US' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, initial.body.version + 1);
  assert.equal((await call(base, oldToken, '/settings/global', 'PUT', { version: initial.body.version, systemName: '过期' })).status, 409);
  const member = await login(base, 'member', 'test');
  assert.equal((await call(base, member, '/settings/global')).status, 403);
  const publicResponse = await fetch(`${base}/settings/public`);
  assert.equal(publicResponse.status, 200);
  const publicSettings = await publicResponse.json();
  assert.equal(publicSettings.systemName, '测试空间');
  assert.equal(publicSettings.sessionHours, undefined);
  const sessions = (await client.query('SELECT token_hash,expires_at FROM auth_sessions ORDER BY created_at')).rows;
  assert.equal(sessions.length, 2);
  assert.equal((await client.query('SELECT expires_at FROM auth_sessions WHERE token_hash=$1', [oldHash.token_hash])).rows[0].expires_at.getTime(), oldHash.expires_at.getTime());
  assert.ok(Math.abs(sessions[1].expires_at.getTime() - (Date.now() + 48 * 3600000)) < 30000);
});

test('personal preferences are isolated and reject invalid values or stale writes', async t => {
  const { base } = await createPgTestServer(t);
  const admin = await login(base, 'admin', 'admin123');
  const member = await login(base, 'member', 'test');
  const initial = await call(base, member, '/settings/preferences');
  assert.equal(initial.body.version, 0);
  const saved = await call(base, member, '/settings/preferences', 'PUT', { version: 0, theme: 'light', language: 'en-US', density: 'compact' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.theme, 'light');
  assert.equal((await call(base, member, '/settings/preferences', 'PUT', { version: 0, theme: 'dark' })).status, 409);
  assert.equal((await call(base, admin, '/settings/preferences')).body.theme, 'dark');
  assert.equal((await call(base, member, '/settings/preferences', 'PUT', { version: saved.body.version, timezone: 'Invalid/Place' })).status, 400);
});
