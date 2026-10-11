import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createPgTestServer } from './pg-helper.mjs';
import { handleProjectAnalyses, resumeProjectAnalyses } from '../mock/project-analyses.mjs';

const sha = 'a'.repeat(40);
const report = JSON.stringify({ summary: '发现项目入口，运行状态尚未验证', findings: [{ title: '入口', status: 'implemented', detail: '存在入口函数', evidence: { path: 'src/main.ts', line: 1, excerpt: 'export function main() {}' } }], suggestions: [{ topic: '验证入口', reason: '静态代码不足以证明运行', practice: '添加集成测试', acceptance: '入口测试通过', findingIndex: 0 }] });

async function fixture(client) {
  const repositoryId = crypto.randomUUID(), scanId = crypto.randomUUID();
  await client.query("INSERT INTO project_repositories(id,owner_id,full_name,branch,goal,requirement_baseline,commit_sha) VALUES($1,'member','octocat/example','main','学习项目','v1',$2)", [repositoryId,sha]);
  await client.query("INSERT INTO project_scans(id,repository_id,full_name,branch,commit_sha,status,coverage_complete,read_count) VALUES($1,$2,'octocat/example','main',$3,'completed',true,1)", [scanId,repositoryId,sha]);
  await client.query("INSERT INTO project_scan_files(scan_id,path,git_sha,byte_size,category,status,content,content_sha256) VALUES($1,'src/main.ts',$2,25,'source','read','export function main() {}',$3)", [scanId,'b'.repeat(40),'c'.repeat(64)]);
  await client.query("INSERT INTO experiment_models(id,name,display_name,api_model,input_usd_per_million,output_usd_per_million,provider,allowed_roles) VALUES('project-model','project-model','Project model','fake-model',1,1,'legacy',ARRAY['admin','member'])");
  await client.query('UPDATE experiment_settings SET daily_budget_usd=10,concurrency_limit=1 WHERE id=1');
  return { repositoryId, scanId, path: `/api/project-repositories/${repositoryId}/analyses` };
}

async function waitFor(client, id) {
  for (let i = 0; i < 100; i++) {
    const row = (await client.query('SELECT status FROM project_analyses WHERE id=$1', [id])).rows[0];
    if (['completed','failed'].includes(row?.status)) return row.status;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('analysis did not finish');
}

test('analysis persists validated report and source evidence, isolates owners, and deduplicates active work', async t => {
  const { client, base } = await createPgTestServer(t);
  const { repositoryId, scanId, path } = await fixture(client);
  const me = { id: 'member', role: 'member' }, other = { id: 'learner', role: 'member' };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const runModel = async () => { await gate; return { output: report, promptTokens: 200, completionTokens: 100 }; };
  const start = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel });
  assert.equal(start.status, 202);
  const duplicate = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel });
  assert.equal(duplicate.data.id, start.data.id);
  assert.equal((await handleProjectAnalyses({ pathname: path, method: 'GET', client, me: other })).status, 404);
  release();
  assert.equal(await waitFor(client, start.data.id), 'completed');
  const detail = await handleProjectAnalyses({ pathname: `${path}/${start.data.id}`, method: 'GET', client, me });
  assert.equal(detail.data.summary, '发现项目入口，运行状态尚未验证');
  assert.equal(detail.data.findings[0].evidence.path, 'src/main.ts');
  assert.equal(detail.data.findings[0].evidence.line, 1);
  assert.equal(detail.data.suggestions[0].findingId, detail.data.findings[0].id);
  assert.equal(detail.data.commitSha, sha);
  assert.equal((await handleProjectAnalyses({ pathname: `${path}/${start.data.id}`, method: 'GET', client, me: other })).status, 404);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_analysis_findings')).rows[0].n, 1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_analysis_suggestions')).rows[0].n, 1);
  assert.equal((await handleProjectAnalyses({ pathname: `/api/project-repositories/${repositoryId}/analyses`, method: 'GET', client, me })).data.items.length, 1);
  assert.equal((await fetch(`${base}/project-repositories/${repositoryId}/analyses`)).status, 401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  const http = await fetch(`${base}/project-repositories/${repositoryId}/analyses/${start.data.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(http.status, 200);
  assert.equal((await http.json()).findings[0].evidence.gitSha, 'b'.repeat(40));
});

test('analysis submission rejects unavailable models and exhausted daily budget before charging', async t => {
  const { client } = await createPgTestServer(t);
  const { scanId, path } = await fixture(client);
  const me = { id: 'member', role: 'member' };
  const request = { pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), runModel: async () => ({ output: report, promptTokens: 1, completionTokens: 1 }) };
  assert.equal((await handleProjectAnalyses({ ...request, connectionAvailable: async () => false })).status, 409);
  await client.query('UPDATE experiment_settings SET daily_budget_usd=0 WHERE id=1');
  assert.equal((await handleProjectAnalyses({ ...request, connectionAvailable: async () => true })).status, 409);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_analyses')).rows[0].n, 0);
});

test('invalid model output fails without a false successful report; queued work resumes once', async t => {
  const { client } = await createPgTestServer(t);
  const { scanId, path } = await fixture(client);
  const me = { id: 'member', role: 'member' };
  const started = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel: async () => ({ output: '{"summary":"fake"}', promptTokens: 1, completionTokens: 1 }) });
  assert.equal(await waitFor(client, started.data.id), 'failed');
  const failed = await handleProjectAnalyses({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me });
  assert.equal(failed.data.summary, null);
  assert.equal(failed.data.findings.length, 0);
  assert.equal(failed.data.errorCode, 'INVALID_REPORT');
  assert.equal(failed.data.promptTokens, 1);
  assert.equal(failed.data.completionTokens, 1);
  assert.ok(failed.data.costUsd > 0);
  const queuedId = crypto.randomUUID();
  await client.query("INSERT INTO project_analyses(id,repository_id,scan_id,owner_id,full_name,branch,commit_sha,goal,requirement_baseline,model_id,provider,api_model,input_price,output_price,estimated_max_cost_usd,status) SELECT $1,repository_id,id,'member',full_name,branch,commit_sha,'学习项目','v1','project-model','legacy','fake-model',1,1,0.1,'queued' FROM project_scans WHERE id=$2", [queuedId,scanId]);
  assert.equal(await resumeProjectAnalyses(client, async () => ({ output: report, promptTokens: 2, completionTokens: 3 })), 1);
  assert.equal(await waitFor(client, queuedId), 'completed');
});

test('HTTP analysis calls the configured server-side model and returns a persisted report', async t => {
  const provider = http.createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer fake-key');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, 'fake-model');
    assert.ok(body.messages[1].content.includes('export function main() {}'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: report } }], usage: { prompt_tokens: 200, completion_tokens: 100 } }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const { client, base } = await createPgTestServer(t, undefined, { MODEL_API_KEY: 'fake-key', MODEL_API_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1` });
  const { repositoryId, scanId } = await fixture(client);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const started = await fetch(`${base}/project-repositories/${repositoryId}/analyses`, { method: 'POST', headers, body: JSON.stringify({ scanId, modelId: 'project-model' }) });
  assert.equal(started.status, 202);
  const { id } = await started.json();
  assert.equal(await waitFor(client, id), 'completed');
  const detail = await fetch(`${base}/project-repositories/${repositoryId}/analyses/${id}`, { headers });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).findings[0].evidence.path, 'src/main.ts');
  let auditRow;
  for (let attempt = 0; attempt < 30; attempt++) {
    auditRow = (await client.query("SELECT prompt_preview FROM model_call_audit WHERE run_id=$1 AND module='project_analysis'", [id])).rows[0];
    if (auditRow) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(auditRow);
  assert.equal(auditRow.prompt_preview, '[仓库代码输入已省略]');
});
