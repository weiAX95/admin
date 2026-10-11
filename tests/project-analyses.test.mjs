import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createPgTestServer } from './pg-helper.mjs';
import { handleProjectAnalyses, resumeProjectAnalyses } from '../mock/project-analyses.mjs';
import { handleProjectSuggestionAction } from '../mock/project-suggestion-actions.mjs';
import { handleProjectFindingFeedback } from '../mock/project-finding-feedback.mjs';

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
    if (['completed','failed','canceled'].includes(row?.status)) return row.status;
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
  assert.deepEqual(detail.data.modules, [{ moduleKey: 'src', indexedCount: 1, readCount: 1, selectedCount: 1, truncatedCount: 0, excludedCount: 0, failedCount: 0, unscannedCount: 0, summary: '发现项目入口，运行状态尚未验证' }]);
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

test('analysis calls the model per selected module and merges evidence with cumulative usage', async t => {
  const { client } = await createPgTestServer(t);
  const { scanId, path } = await fixture(client);
  await client.query("INSERT INTO project_scan_files(scan_id,path,git_sha,byte_size,category,status,content,content_sha256) VALUES($1,'src/pages/home.ts',$2,24,'source','read','export const home = true;',$3)", [scanId,'d'.repeat(40),'e'.repeat(64)]);
  let calls = 0;
  const runModel = async (_db,_job,messages) => {
    calls++;
    const input = JSON.parse(messages[1].content);
    assert.equal(input.files.length,1);
    const file = input.files[0];
    return { output: JSON.stringify({ summary: `已查看 ${input.moduleKey}`, findings: [{ title: input.moduleKey, status: 'implemented', detail: '有代码入口', evidence: { path: file.path, line: 1, excerpt: file.lines.split('\n')[0].replace(/^1: /,'') } }], suggestions: [{ topic: '验证入口', reason: '需要测试', practice: '编写测试', acceptance: '测试通过', findingIndex: 0 }] }), promptTokens: 10, completionTokens: 5 };
  };
  const me = { id: 'member', role: 'member' };
  const started = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel });
  assert.equal(await waitFor(client, started.data.id), 'completed');
  const detail = (await handleProjectAnalyses({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me })).data;
  assert.equal(calls,2);
  assert.deepEqual(detail.findings.map(finding => finding.moduleKey), ['src','src/pages']);
  assert.deepEqual(detail.suggestions.map(suggestion => suggestion.findingId), detail.findings.map(finding => finding.id));
  assert.deepEqual(detail.modules.map(module => module.summary), ['已查看 src','已查看 src/pages']);
  assert.equal(detail.promptTokens,20);
  assert.equal(detail.completionTokens,10);
  assert.equal((await client.query('SELECT reserved_requests::int AS calls FROM model_rate_reservations WHERE run_id=$1', [`${started.data.id}:1`])).rows[0].calls,2);
});

test('a later module failure retains earlier call cost without publishing a partial report', async t => {
  const { client } = await createPgTestServer(t);
  const { scanId, path } = await fixture(client);
  await client.query("INSERT INTO project_scan_files(scan_id,path,git_sha,byte_size,category,status,content,content_sha256) VALUES($1,'src/pages/home.ts',$2,24,'source','read','export const home = true;',$3)", [scanId,'d'.repeat(40),'e'.repeat(64)]);
  let calls = 0;
  const runModel = async () => ({ output: ++calls === 1 ? report : '{"summary":"invalid"}', promptTokens: 10, completionTokens: 5 });
  const me = { id: 'member', role: 'member' };
  const started = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel });
  assert.equal(await waitFor(client, started.data.id), 'failed');
  const detail = (await handleProjectAnalyses({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me })).data;
  assert.equal(detail.errorCode,'INVALID_REPORT');
  assert.equal(detail.summary,null);
  assert.deepEqual(detail.findings,[]);
  assert.deepEqual(detail.modules,[]);
  assert.equal(detail.promptTokens,20);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_analysis_model_charges WHERE analysis_id=$1', [started.data.id])).rows[0].n,2);
});

test('accepting a learning suggestion creates one linked task with task history side effects', async t => {
  const { client, base } = await createPgTestServer(t);
  const { scanId, path } = await fixture(client);
  const me = { id: 'member', username: 'member', role: 'member' };
  const started = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel: async () => ({ output: report, promptTokens: 2, completionTokens: 3 }) });
  assert.equal(await waitFor(client,started.data.id),'completed');
  const detail = (await handleProjectAnalyses({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me })).data;
  const actionPath = `${path}/${started.data.id}/suggestions/${detail.suggestions[0].id}/accept`;
  const accepted = await handleProjectSuggestionAction({ pathname: actionPath, method: 'POST', client, me });
  assert.equal(accepted.status,201);
  const repeated = await handleProjectSuggestionAction({ pathname: actionPath, method: 'POST', client, me });
  assert.equal(repeated.status,200);
  assert.equal(repeated.data.taskId,accepted.data.taskId);
  assert.equal((await fetch(`${base}${actionPath.slice(4)}`, { method: 'POST' })).status,401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  const httpRepeat = await fetch(`${base}${actionPath.slice(4)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(httpRepeat.status,200);
  assert.equal((await httpRepeat.json()).taskId,accepted.data.taskId);
  const task = (await client.query('SELECT * FROM tasks WHERE id=$1', [accepted.data.taskId])).rows[0];
  assert.equal(task.title,'验证入口');
  assert.match(task.description,/添加集成测试/);
  assert.match(task.description,/入口测试通过/);
  assert.match(task.description,/github.com\/octocat\/example\/blob\//);
  assert.equal(task.owner_id,'member');
  assert.equal((await client.query("SELECT count(*)::int AS n FROM task_trend_events WHERE task_id=$1 AND type='create'", [task.id])).rows[0].n,1);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM activity WHERE task_id=$1 AND type='create'", [task.id])).rows[0].n,1);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_suggestion_decisions WHERE suggestion_id=$1', [detail.suggestions[0].id])).rows[0].n,1);
  const refreshed = (await handleProjectAnalyses({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me })).data;
  assert.deepEqual(refreshed.suggestions[0].decision.status,'accepted');
  assert.equal(refreshed.suggestions[0].decision.taskId,task.id);
  const second = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel: async () => ({ output: report, promptTokens: 2, completionTokens: 3 }) });
  assert.equal(await waitFor(client,second.data.id),'completed');
  const secondDetail = (await handleProjectAnalyses({ pathname: `${path}/${second.data.id}`, method: 'GET', client, me })).data;
  const duplicate = await handleProjectSuggestionAction({ pathname: `${path}/${second.data.id}/suggestions/${secondDetail.suggestions[0].id}/accept`, method: 'POST', client, me });
  assert.equal(duplicate.status,409);
  assert.equal(duplicate.data.taskId,task.id);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM tasks WHERE title='验证入口'")).rows[0].n,1);
});

test('suggestion decisions reject stale reports and preserve an ignored choice', async t => {
  const { client } = await createPgTestServer(t);
  const { repositoryId, scanId, path } = await fixture(client);
  const me = { id: 'member', username: 'member', role: 'member' };
  const started = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel: async () => ({ output: report, promptTokens: 2, completionTokens: 3 }) });
  assert.equal(await waitFor(client,started.data.id),'completed');
  const detail = (await handleProjectAnalyses({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me })).data;
  const base = `${path}/${started.data.id}/suggestions/${detail.suggestions[0].id}`;
  assert.equal((await handleProjectSuggestionAction({ pathname: `${base}/accept`, method: 'POST', client, me: { id: 'learner', role: 'member' } })).status,404);
  await client.query('UPDATE project_repositories SET goal=$2 WHERE id=$1', [repositoryId,'新的项目目标']);
  assert.equal((await handleProjectSuggestionAction({ pathname: `${base}/accept`, method: 'POST', client, me })).status,409);
  assert.equal((await handleProjectSuggestionAction({ pathname: `${base}/ignore`, method: 'POST', client, me })).status,200);
  assert.equal((await handleProjectSuggestionAction({ pathname: `${base}/ignore`, method: 'POST', client, me })).status,200);
  assert.equal((await handleProjectSuggestionAction({ pathname: `${base}/accept`, method: 'POST', client, me })).status,409);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM tasks WHERE category='项目学习'")).rows[0].n,0);
});

test('human feedback preserves model evidence, author, history, and stale report warning', async t => {
  const { client, base } = await createPgTestServer(t);
  const { repositoryId, scanId, path } = await fixture(client);
  const me = { id: 'member', username: 'member', role: 'member' };
  const started = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel: async () => ({ output: report, promptTokens: 2, completionTokens: 3 }) });
  assert.equal(await waitFor(client,started.data.id),'completed');
  const initial = (await handleProjectAnalyses({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me })).data;
  const findingId = initial.findings[0].id;
  const pathname = `${path}/${started.data.id}/findings/${findingId}/feedback`;
  const request = { pathname, method: 'POST', client, me };
  assert.equal((await handleProjectFindingFeedback({ ...request, readBody: async () => ({ correctedStatus: 'done', reason: '已经人工验证运行正常' }) })).status,400);
  assert.equal((await handleProjectFindingFeedback({ ...request, me: { id: 'learner' }, readBody: async () => ({ correctedStatus: 'partial', reason: '仅静态代码可见，尚未在环境中运行' }) })).status,404);
  assert.equal((await handleProjectFindingFeedback({ ...request, readBody: async () => ({ correctedStatus: 'partial', reason: '仅静态代码可见，尚未在环境中运行' }) })).status,201);
  assert.equal((await handleProjectFindingFeedback({ ...request, readBody: async () => ({ correctedStatus: 'unverified', reason: '回归测试显示入口尚未通过完整验收' }) })).status,201);
  assert.equal((await fetch(`${base}${pathname.slice(4)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correctedStatus: 'partial', reason: '已经确认只覆盖一部分实现' }) })).status,401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  assert.equal((await fetch(`${base}${pathname.slice(4)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ correctedStatus: 'partial', reason: '已经确认只覆盖一部分实现' }) })).status,201);
  await client.query('UPDATE project_repositories SET commit_sha=$2 WHERE id=$1',[repositoryId,'d'.repeat(40)]);
  const detail = (await handleProjectAnalyses({ pathname: `${path}/${started.data.id}`, method: 'GET', client, me })).data;
  assert.deepEqual(detail.staleReasons,['仓库 commit 已变化']);
  assert.equal(detail.findings[0].status,'implemented');
  assert.equal(detail.findings[0].evidence.path,'src/main.ts');
  assert.equal(detail.findings[0].feedback.length,3);
  assert.deepEqual(new Set(detail.findings[0].feedback.map(entry => entry.correctedStatus)),new Set(['unverified','partial']));
  assert.deepEqual(detail.findings[0].feedback.map(entry => entry.author),['member','member','member']);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_finding_feedback WHERE finding_id=$1',[findingId])).rows[0].n,3);
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

test('active analysis can be canceled without persisting a late model response', async t => {
  const { client } = await createPgTestServer(t);
  const { scanId, path } = await fixture(client);
  const me = { id: 'member', role: 'member' };
  let entered;
  const running = new Promise(resolve => { entered = resolve; });
  const runModel = async (_db, _job, _messages, signal) => {
    entered();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { output: report, promptTokens: 1, completionTokens: 1 };
  };
  const started = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel });
  await running;
  const canceled = await handleProjectAnalyses({ pathname: `${path}/${started.data.id}/cancel`, method: 'POST', client, me });
  assert.equal(canceled.status, 200);
  assert.equal(await waitFor(client, started.data.id), 'canceled');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_analysis_findings WHERE analysis_id=$1', [started.data.id])).rows[0].n, 0);
  assert.equal((await handleProjectAnalyses({ pathname: `${path}/${started.data.id}/cancel`, method: 'POST', client, me: { id: 'learner', role: 'member' } })).status, 404);
});

test('failed analysis retries with fresh reservation and stops at attempt limit', async t => {
  const { client } = await createPgTestServer(t);
  const { scanId, path } = await fixture(client);
  const me = { id: 'member', role: 'member' };
  const runModel = async () => ({ output: '{"summary":"invalid"}', promptTokens: 1, completionTokens: 1 });
  const started = await handleProjectAnalyses({ pathname: path, method: 'POST', client, me, readBody: async () => ({ scanId, modelId: 'project-model' }), connectionAvailable: async () => true, runModel });
  assert.equal(await waitFor(client, started.data.id), 'failed');
  const first = (await client.query('SELECT estimated_max_cost_usd FROM project_analysis_attempts WHERE analysis_id=$1 AND attempt=1', [started.data.id])).rows[0];
  await client.query('UPDATE experiment_settings SET daily_budget_usd=$1 WHERE id=1', [first.estimated_max_cost_usd]);
  assert.equal((await handleProjectAnalyses({ pathname: `${path}/${started.data.id}/retry`, method: 'POST', client, me, connectionAvailable: async () => true, runModel })).status, 429);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_analysis_attempts WHERE analysis_id=$1', [started.data.id])).rows[0].n, 1);
  await client.query("UPDATE project_analysis_model_charges SET charged_at=now()-interval '2 days' WHERE analysis_id=$1", [started.data.id]);
  for (let attempt = 2; attempt <= 3; attempt++) {
    const retried = await handleProjectAnalyses({ pathname: `${path}/${started.data.id}/retry`, method: 'POST', client, me, connectionAvailable: async () => true, runModel });
    assert.equal(retried.status, 202);
    assert.equal(await waitFor(client, started.data.id), 'failed');
    assert.equal((await client.query('SELECT attempts FROM project_analyses WHERE id=$1', [started.data.id])).rows[0].attempts, attempt);
    if (attempt === 2) await client.query('UPDATE experiment_settings SET daily_budget_usd=10 WHERE id=1');
  }
  assert.equal((await handleProjectAnalyses({ pathname: `${path}/${started.data.id}/retry`, method: 'POST', client, me, connectionAvailable: async () => true, runModel })).status, 409);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM model_token_reservations WHERE run_id LIKE $1', [`${started.data.id}%`])).rows[0].n, 3);
  const attempts = (await client.query('SELECT attempt,status,cost_usd FROM project_analysis_attempts WHERE analysis_id=$1 ORDER BY attempt', [started.data.id])).rows;
  assert.deepEqual(attempts.map(row => row.attempt), [1,2,3]);
  assert.ok(attempts.every(row => row.status === 'failed' && Number(row.cost_usd) > 0));
  const total = (await client.query('SELECT cost_usd FROM project_analyses WHERE id=$1', [started.data.id])).rows[0].cost_usd;
  assert.equal(Number(total), attempts.reduce((sum,row) => sum + Number(row.cost_usd),0));
});

test('HTTP analysis calls the configured server-side model and returns a persisted report', async t => {
  const providerCalls = [];
  const provider = http.createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer fake-key');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, 'fake-model');
    const input = JSON.parse(body.messages[1].content);
    providerCalls.push(input.moduleKey);
    const file = input.files[0];
    const output = JSON.stringify({ summary: `已查看 ${input.moduleKey}`, findings: [{ title: '入口', status: 'implemented', detail: '存在入口', evidence: { path: file.path, line: 1, excerpt: file.lines.split('\n')[0].replace(/^1: /,'') } }], suggestions: [] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: output } }], usage: { prompt_tokens: 200, completion_tokens: 100 } }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const { client, base } = await createPgTestServer(t, undefined, { MODEL_API_KEY: 'fake-key', MODEL_API_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1` });
  const { repositoryId, scanId } = await fixture(client);
  await client.query("INSERT INTO project_scan_files(scan_id,path,git_sha,byte_size,category,status,content,content_sha256) VALUES($1,'src/pages/home.ts',$2,24,'source','read','export const home = true;',$3)", [scanId,'d'.repeat(40),'e'.repeat(64)]);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const started = await fetch(`${base}/project-repositories/${repositoryId}/analyses`, { method: 'POST', headers, body: JSON.stringify({ scanId, modelId: 'project-model' }) });
  assert.equal(started.status, 202);
  const { id } = await started.json();
  assert.equal(await waitFor(client, id), 'completed');
  const detail = await fetch(`${base}/project-repositories/${repositoryId}/analyses/${id}`, { headers });
  assert.equal(detail.status, 200);
  const saved = await detail.json();
  assert.deepEqual(saved.findings.map(finding => finding.evidence.path), ['src/main.ts','src/pages/home.ts']);
  assert.deepEqual(providerCalls,['src','src/pages']);
  let auditRow;
  for (let attempt = 0; attempt < 30; attempt++) {
    auditRow = (await client.query("SELECT prompt_preview FROM model_call_audit WHERE run_id=$1 AND module='project_analysis'", [id])).rows[0];
    if (auditRow) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(auditRow);
  assert.equal(auditRow.prompt_preview, '[仓库代码输入已省略]');
  for (let attempt = 0; attempt < 30; attempt++) {
    const count = (await client.query("SELECT count(*)::int AS n FROM model_call_audit WHERE run_id=$1 AND module='project_analysis'", [id])).rows[0].n;
    if (count === 2) break;
    await new Promise(resolve => setTimeout(resolve,20));
  }
  assert.equal((await client.query("SELECT count(*)::int AS n FROM model_call_audit WHERE run_id=$1 AND module='project_analysis'", [id])).rows[0].n,2);
});
