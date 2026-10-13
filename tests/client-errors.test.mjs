import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';

test('authenticated render reports keep only safe metadata and are rate limited', async t => {
  const { base, client } = await createPgTestServer(t);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  const post = (body, authorization = token) => fetch(`${base}/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, body: JSON.stringify(body) });
  const report = { path: '/share/experiments/private-token', errorName: 'TypeError', components: ['TaskTimeTracking', 'TaskDetail'], message: 'private content', stack: 'secret stack' };
  assert.equal((await post(report, '')).status, 401);
  assert.equal((await post({ ...report, components: ['bad name'] })).status, 400);
  assert.equal((await post({ ...report, path: '/tasks?id=secret' })).status, 400);
  assert.equal((await post(report)).status, 201);
  const saved = (await client.query('SELECT user_id,path,error_name,components FROM client_error_reports')).rows;
  assert.deepEqual(saved, [{ user_id: 'member', path: '/share/experiments/:token', error_name: 'TypeError', components: ['TaskTimeTracking', 'TaskDetail'] }]);
  const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='client_error_reports'")).rows.map(row => row.column_name);
  assert.ok(!columns.includes('message') && !columns.includes('stack'));
  for (let index = 1; index < 20; index++) assert.equal((await post(report)).status, 201);
  const limited = await post(report);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '60');
  assert.equal((await client.query('SELECT count(*)::int AS count FROM client_error_reports')).rows[0].count, 20);
});
