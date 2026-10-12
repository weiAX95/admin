import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPgTestServer } from './pg-helper.mjs';

const sha = 'a'.repeat(40);

test('project analysis relationships cannot cross repositories or owners', async t => {
  const { client } = await createPgTestServer(t);
  const repositoryA = randomUUID(), repositoryB = randomUUID();
  const scanA = randomUUID(), scanB = randomUUID();
  for (const [id, owner] of [[repositoryA, 'member'], [repositoryB, 'learner']]) {
    await client.query("INSERT INTO project_repositories(id,owner_id,full_name,branch,goal,commit_sha) VALUES($1,$2,'octocat/example','main','学习',$3)", [id, owner, sha]);
  }
  for (const [id, repository] of [[scanA, repositoryA], [scanB, repositoryB]]) {
    await client.query("INSERT INTO project_scans(id,repository_id,full_name,branch,commit_sha,status) VALUES($1,$2,'octocat/example','main',$3,'completed')", [id, repository, sha]);
  }
  await client.query("INSERT INTO experiment_models(id,name,display_name,api_model,input_usd_per_million,output_usd_per_million,provider) VALUES('integrity-model','integrity-model','Integrity model','test',1,1,'legacy')");
  const insertAnalysis = (id, repository, scan, owner) => client.query(`INSERT INTO project_analyses
    (id,repository_id,scan_id,owner_id,full_name,branch,commit_sha,goal,requirement_baseline,model_id,provider,api_model,input_price,output_price,estimated_max_cost_usd,status)
    VALUES ($1,$2,$3,$4,'octocat/example','main',$5,'学习','','integrity-model','legacy','test',1,1,1,'failed')`, [id, repository, scan, owner, sha]);
  await assert.rejects(insertAnalysis(randomUUID(), repositoryA, scanA, 'learner'), { code: '23503' });
  await assert.rejects(insertAnalysis(randomUUID(), repositoryA, scanB, 'member'), { code: '23503' });
  const analysisA = randomUUID(), analysisB = randomUUID();
  await insertAnalysis(analysisA, repositoryA, scanA, 'member');
  await insertAnalysis(analysisB, repositoryB, scanB, 'learner');

  const baselineA = randomUUID(), baselineB = randomUUID();
  for (const [id, repository] of [[baselineA, repositoryA], [baselineB, repositoryB]]) {
    await client.query("INSERT INTO project_requirement_baselines(id,repository_id,version,content,content_sha256) VALUES($1,$2,1,'需求',$3)", [id, repository, 'c'.repeat(64)]);
  }
  await assert.rejects(client.query('UPDATE project_repositories SET baseline_version_id=$2 WHERE id=$1', [repositoryA, baselineB]), { code: '23503' });
  await assert.rejects(client.query('UPDATE project_analyses SET baseline_version_id=$2 WHERE id=$1', [analysisA, baselineB]), { code: '23503' });
  await client.query('UPDATE project_repositories SET baseline_version_id=$2 WHERE id=$1', [repositoryA, baselineA]);
  await client.query('UPDATE project_analyses SET baseline_version_id=$2 WHERE id=$1', [analysisA, baselineA]);
  await client.query('DELETE FROM project_requirement_baselines WHERE id=$1', [baselineA]);
  assert.equal((await client.query('SELECT baseline_version_id FROM project_repositories WHERE id=$1', [repositoryA])).rows[0].baseline_version_id, null);
  assert.equal((await client.query('SELECT baseline_version_id FROM project_analyses WHERE id=$1', [analysisA])).rows[0].baseline_version_id, null);

  const suggestionA = randomUUID(), suggestionB = randomUUID();
  for (const [id, analysis] of [[suggestionA, analysisA], [suggestionB, analysisB]]) {
    await client.query("INSERT INTO project_analysis_suggestions(id,analysis_id,position,topic,reason,practice,acceptance) VALUES($1,$2,0,'主题','理由','实践','验收')", [id, analysis]);
  }
  const findingA = randomUUID(), findingB = randomUUID();
  for (const [id, analysis] of [[findingA, analysisA], [findingB, analysisB]]) {
    await client.query("INSERT INTO project_analysis_findings(id,analysis_id,position,title,status,detail) VALUES($1,$2,0,'功能','unverified','待验证')", [id, analysis]);
  }
  await assert.rejects(client.query('UPDATE project_analysis_suggestions SET finding_id=$2 WHERE id=$1', [suggestionA, findingB]), { code: '23503' });
  await client.query('UPDATE project_analysis_suggestions SET finding_id=$2 WHERE id=$1', [suggestionA, findingA]);
  const feedback = (finding, analysis, owner) => client.query("INSERT INTO project_finding_feedback(id,analysis_id,finding_id,owner_id,corrected_status,reason) VALUES($1,$2,$3,$4,'partial','人工复核后发现尚未完成')", [randomUUID(), analysis, finding, owner]);
  await assert.rejects(feedback(findingB, analysisA, 'member'), { code: '23503' });
  await assert.rejects(feedback(findingA, analysisA, 'learner'), { code: '23503' });
  await feedback(findingA, analysisA, 'member');
  const decide = (suggestion, analysis, repository, owner) => client.query(`INSERT INTO project_suggestion_decisions
    (suggestion_id,analysis_id,repository_id,owner_id,state,fingerprint)
    VALUES ($1,$2,$3,$4,'ignored',$5)`, [suggestion, analysis, repository, owner, 'f'.repeat(64)]);
  await assert.rejects(decide(suggestionA, analysisB, repositoryB, 'learner'), { code: '23503' });
  await assert.rejects(decide(suggestionA, analysisA, repositoryB, 'member'), { code: '23503' });
  await assert.rejects(decide(suggestionA, analysisA, repositoryA, 'learner'), { code: '23503' });
  await decide(suggestionA, analysisA, repositoryA, 'member');
  assert.equal((await client.query('SELECT count(*)::int AS n FROM project_suggestion_decisions')).rows[0].n, 1);
});
