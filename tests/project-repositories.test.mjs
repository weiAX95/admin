import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';
import { parseGitHubRepository, handleProjectRepositories } from '../mock/project-repositories.mjs';

const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('public GitHub repository URL validation rejects hosts, credentials and extra paths', () => {
  assert.deepEqual(parseGitHubRepository('https://github.com/Octocat/Hello-World.git'), { owner: 'Octocat', repo: 'Hello-World', fullName: 'Octocat/Hello-World' });
  for (const url of ['http://github.com/a/b', 'https://github.com.evil.test/a/b', 'https://user@github.com/a/b', 'https://github.com/a/b/tree/main', 'https://github.com/a/b?x=1', 'https://github.com/a']) {
    assert.throws(() => parseGitHubRepository(url), /GitHub 仓库地址/);
  }
});

test('repository registration pins a public branch commit and isolates accounts', async t => {
  const { client } = await createPgTestServer(t);
  const calls = [];
  const fetchGithub = async url => {
    calls.push(url);
    if (url.endsWith('/repos/Octocat/Hello-World')) return response(200, { full_name: 'Octocat/Hello-World', private: false, default_branch: 'main', empty: false });
    if (url.endsWith('/branches/main')) return response(200, { name: 'main', commit: { sha: 'a'.repeat(40) } });
    return response(404, {});
  };
  const body = { url: 'https://github.com/Octocat/Hello-World', branch: 'main', goal: '完成学习项目', requirementBaseline: '需求 v1' };
  const me = { id: 'member', role: 'member' }, other = { id: 'learner', role: 'member' };
  const created = await handleProjectRepositories({ pathname: '/api/project-repositories', method: 'POST', client, me, readBody: async () => body, fetchGithub });
  assert.equal(created.status, 201);
  assert.equal(created.data.fullName, 'Octocat/Hello-World');
  assert.equal(created.data.commitSha, 'a'.repeat(40));
  assert.equal(created.data.lastAnalysisAt, null);
  assert.equal(created.data.lastAnalyzedCommitSha, null);
  assert.equal(calls.length, 2);
  const mine = await handleProjectRepositories({ pathname: '/api/project-repositories', method: 'GET', client, me });
  assert.equal(mine.data.items.length, 1);
  assert.equal(mine.data.items[0].lastAnalysisAt, null);
  const hidden = await handleProjectRepositories({ pathname: `/api/project-repositories/${created.data.id}`, method: 'GET', client, me: other });
  assert.equal(hidden.status, 404);
  const hiddenList = await handleProjectRepositories({ pathname: '/api/project-repositories', method: 'GET', client, me: other });
  assert.equal(hiddenList.data.items.length, 0);
  const forbiddenRefresh = await handleProjectRepositories({ pathname: `/api/project-repositories/${created.data.id}/refresh`, method: 'POST', client, me: other, fetchGithub });
  assert.equal(forbiddenRefresh.status, 404);
  const refreshed = await handleProjectRepositories({ pathname: `/api/project-repositories/${created.data.id}/refresh`, method: 'POST', client, me, fetchGithub });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.commitSha, 'a'.repeat(40));
  assert.equal(refreshed.data.lastAnalysisAt, null);
  const persisted = (await client.query('SELECT owner_id,commit_sha FROM project_repositories WHERE id=$1', [created.data.id])).rows[0];
  assert.deepEqual(persisted, { owner_id: 'member', commit_sha: 'a'.repeat(40) });
  assert.match(created.data.id, /^[0-9a-f-]{36}$/);
});

test('HTTP project routes require a live login before reading account projects', async t => {
  const { base } = await createPgTestServer(t);
  assert.equal((await fetch(`${base}/project-repositories`)).status, 401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  const listing = await fetch(`${base}/project-repositories`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(listing.status, 200);
  assert.deepEqual((await listing.json()).items, []);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/project-repositories`, { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(`${base}/project-repositories`, { method: 'POST', headers, body: JSON.stringify({ url: 'x'.repeat(17000) }) })).status, 413);
});

test('repository task links require project ownership and an eligible task, then follow task deletion', async t => {
  const { client } = await createPgTestServer(t);
  const id = '11111111-1111-4111-8111-111111111111';
  await client.query("INSERT INTO project_repositories(id,owner_id,full_name,branch,goal,commit_sha) VALUES($1,'member','octocat/example','main','学习项目',$2)", [id,'a'.repeat(40)]);
  await client.query("INSERT INTO tasks(id,title,status,owner_id) VALUES('member-task','成员任务','todo','member')");
  const path = `/api/project-repositories/${id}/tasks`;
  const member = { id: 'member', role: 'member' };
  const other = { id: 'learner', role: 'member' };
  const add = body => handleProjectRepositories({ pathname: path, method: 'POST', client, me: member, readBody: async () => body });
  assert.equal((await add({ taskId: 'seed-task-1' })).status, 404);
  assert.equal((await add({ taskId: 'missing' })).status, 404);
  assert.equal((await add({ taskId: 'member-task' })).status, 200);
  assert.equal((await add({ taskId: 'member-task' })).status, 200);
  assert.equal((await handleProjectRepositories({ pathname: path, method: 'GET', client, me: other })).status, 404);
  assert.equal((await handleProjectRepositories({ pathname: path, method: 'GET', client, me: member })).data.items.length, 1);
  assert.equal((await handleProjectRepositories({ pathname: `${path}/member-task`, method: 'DELETE', client, me: other })).status, 404);
  await client.query("UPDATE tasks SET deleted_at=now() WHERE id='member-task'");
  assert.equal((await handleProjectRepositories({ pathname: path, method: 'GET', client, me: member })).data.items.length, 0);
  await client.query("UPDATE tasks SET deleted_at=NULL WHERE id='member-task'");
  assert.equal((await handleProjectRepositories({ pathname: path, method: 'GET', client, me: member })).data.items.length, 1);
  assert.equal((await handleProjectRepositories({ pathname: `${path}/member-task`, method: 'DELETE', client, me: member })).status, 200);
  assert.equal((await handleProjectRepositories({ pathname: path, method: 'GET', client, me: member })).data.items.length, 0);
  assert.equal((await add({ taskId: 'member-task' })).status, 200);
  await client.query("DELETE FROM tasks WHERE id='member-task'");
  assert.equal((await handleProjectRepositories({ pathname: path, method: 'GET', client, me: member })).data.items.length, 0);
});

test('repository registration reports private, empty, missing and network failures without saving', async t => {
  const { client } = await createPgTestServer(t);
  const base = { pathname: '/api/project-repositories', method: 'POST', client, me: { id: 'member', role: 'member' }, readBody: async () => ({ url: 'https://github.com/a/b', goal: '学习' }) };
  const privateRepo = await handleProjectRepositories({ ...base, fetchGithub: async () => response(200, { full_name: 'a/b', private: true, default_branch: 'main' }) });
  assert.equal(privateRepo.status, 403);
  const emptyRepo = await handleProjectRepositories({ ...base, fetchGithub: async () => response(200, { full_name: 'a/b', private: false, default_branch: 'main', size: 0 }) });
  assert.equal(emptyRepo.status, 422);
  const missing = await handleProjectRepositories({ ...base, fetchGithub: async () => response(404, {}) });
  assert.equal(missing.status, 404);
  const network = await handleProjectRepositories({ ...base, fetchGithub: async () => { throw new Error('socket'); } });
  assert.equal(network.status, 502);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_repositories')).rows[0].n, 0);
});
