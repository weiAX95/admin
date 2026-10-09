import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPgTestServer } from './pg-helper.mjs';
import { handleProjectScans, resumeProjectScans } from '../mock/project-scan-jobs.mjs';

const SHA = 'a'.repeat(40);
const completedScan = () => ({ commitSha: SHA, treeSha: 'b'.repeat(40), files: [
  { path: 'README.md', gitSha: 'c'.repeat(40), size: 10, category: 'documentation', status: 'read', contentSha256: 'd'.repeat(64), content: 'study plan' },
  { path: '.env', gitSha: 'e'.repeat(40), size: 10, category: 'source', status: 'excluded', reason: 'sensitive_path' },
], readCount: 1, attemptedCount: 1, failedCount: 0, excludedCount: 1, unscannedCount: 0, unscannedSubtrees: 0, totalBytes: 10, coverageComplete: true });

async function waitFor(client, id) {
  for (let i = 0; i < 50; i++) {
    const row = (await client.query('SELECT status FROM project_scans WHERE id=$1', [id])).rows[0];
    if (['completed', 'partial', 'failed'].includes(row?.status)) return row.status;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('scan did not finish');
}

test('scan job persists exact commit and per-file coverage, scoped to repository owner', async t => {
  const { client, base } = await createPgTestServer(t);
  const repoId = crypto.randomUUID();
  await client.query('INSERT INTO project_repositories(id,owner_id,full_name,branch,goal,commit_sha) VALUES($1,$2,$3,$4,$5,$6)', [repoId,'member','octocat/example','main','study',SHA]);
  const path = `/api/project-repositories/${repoId}/scans`;
  const me = { id: 'member', role: 'member' }, other = { id: 'learner', role: 'member' };
  assert.equal((await fetch(`${base}/project-repositories/${repoId}/scans`)).status, 401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  assert.equal((await fetch(`${base}/project-repositories/${repoId}/scans`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await handleProjectScans({ pathname: path, method: 'GET', client, me: other })).status, 404);
  assert.equal((await handleProjectScans({ pathname: path, method: 'POST', client, me: other })).status, 404);
  const started = await handleProjectScans({ pathname: path, method: 'POST', client, me, scanRepository: async input => {
    assert.equal(input.commitSha, SHA);
    return completedScan();
  } });
  assert.equal(started.status, 202);
  assert.equal(await waitFor(client, started.data.id), 'completed');
  const listing = await handleProjectScans({ pathname: path, method: 'GET', client, me });
  assert.equal(listing.data.items[0].readCount, 1);
  assert.equal(listing.data.items[0].excludedCount, 1);
  assert.equal(listing.data.items[0].coverageComplete, true);
  const detail = await handleProjectScans({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me });
  assert.deepEqual(detail.data.files.map(file => file.path), ['.env', 'README.md']);
  assert.equal(JSON.stringify(detail.data).includes('study plan'), false);
  const filePath = `${path}/${started.data.id}/files`;
  const content = await handleProjectScans({ pathname: filePath, method: 'GET', client, me, url: new URL(`http://local${filePath}?path=README.md`) });
  assert.equal(content.data.content, 'study plan');
  const httpContent = await fetch(`${base}/project-repositories/${repoId}/scans/${started.data.id}/files?path=README.md`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(httpContent.status, 200);
  assert.equal((await httpContent.json()).content, 'study plan');
  assert.equal((await handleProjectScans({ pathname: filePath, method: 'GET', client, me: other, url: new URL(`http://local${filePath}?path=README.md`) })).status, 404);
  assert.equal((await handleProjectScans({ pathname: filePath, method: 'GET', client, me, url: new URL(`http://local${filePath}?path=.env`) })).status, 404);
  assert.equal((await handleProjectScans({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me: other })).status, 404);
});

test('in-flight duplicate scan reuses job; restart resumes a persisted queue item', async t => {
  const { client } = await createPgTestServer(t);
  const repoId = crypto.randomUUID();
  await client.query('INSERT INTO project_repositories(id,owner_id,full_name,branch,goal,commit_sha) VALUES($1,$2,$3,$4,$5,$6)', [repoId,'member','octocat/example','main','study',SHA]);
  const me = { id: 'member', role: 'member' }, path = `/api/project-repositories/${repoId}/scans`;
  let release;
  const stalled = new Promise(resolve => { release = resolve; });
  const first = await handleProjectScans({ pathname: path, method: 'POST', client, me, scanRepository: async () => { await stalled; return completedScan(); } });
  const second = await handleProjectScans({ pathname: path, method: 'POST', client, me });
  assert.equal(second.data.id, first.data.id);
  release();
  assert.equal(await waitFor(client, first.data.id), 'completed');
  const queuedId = crypto.randomUUID();
  await client.query("INSERT INTO project_scans(id,repository_id,full_name,branch,commit_sha,status) VALUES($1,$2,'octocat/example','main',$3,'queued')", [queuedId,repoId,SHA]);
  await resumeProjectScans(client, async () => ({ ...completedScan(), coverageComplete: false, unscannedCount: 1 }));
  assert.equal(await waitFor(client, queuedId), 'partial');
});

test('project scan API replies while legacy request transaction is active', async t => {
  const { client, base } = await createPgTestServer(t);
  const repoId = crypto.randomUUID();
  await client.query('INSERT INTO project_repositories(id,owner_id,full_name,branch,goal,commit_sha) VALUES($1,$2,$3,$4,$5,$6)', [repoId,'member','octocat/example','main','study',SHA]);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };
  await client.query('SELECT pg_advisory_lock(748201)');
  try {
    const blocked = fetch(`${base}/tasks`, { headers });
    await new Promise(resolve => setTimeout(resolve, 50));
    const independent = await fetch(`${base}/project-repositories/${repoId}/scans`, { headers, signal: AbortSignal.timeout(1000) });
    assert.equal(independent.status, 200);
    await client.query('SELECT pg_advisory_unlock(748201)');
    assert.equal((await blocked).status, 200);
  } finally { await client.query('SELECT pg_advisory_unlock(748201)'); }
});
