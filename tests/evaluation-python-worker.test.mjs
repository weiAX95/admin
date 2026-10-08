import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { runBertScore, runPythonMetric, pythonMetricAvailable } from '../mock/evaluation-python-worker.mjs';
import { createPgTestServer } from './pg-helper.mjs';

test('Python metric requires a container image, enforces timeout, and rejects invalid output', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'evaluation-docker-'));
  const docker=path.join(dir,'docker');
  await fs.writeFile(docker,`#!/usr/bin/env node
const args=process.argv.slice(2);let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
 if(args[0]==='image'){process.stdout.write('[]');return;}
 if(args[0]==='rm'){process.stdout.write('{}');return;}
 const data=JSON.parse(input);if(data.source?.includes('hang'))return setTimeout(()=>process.stdout.write('{"score":0.5}'),2000);
 process.stdout.write(data.source?.includes('invalid')?'{"score":2}':'{"score":0.5}');
});
`);
  await fs.chmod(docker,0o755);
  const previousPath=process.env.PATH,previousImage=process.env.EVALUATION_PYTHON_IMAGE,previousBertImage=process.env.EVALUATION_BERTSCORE_IMAGE,previousBertEnabled=process.env.EVALUATION_BERTSCORE_ENABLED;
  process.env.PATH=`${dir}:${previousPath}`;process.env.EVALUATION_PYTHON_IMAGE='test-image';delete process.env.EVALUATION_BERTSCORE_IMAGE;
  t.after(async()=>{process.env.PATH=previousPath;if(previousImage===undefined)delete process.env.EVALUATION_PYTHON_IMAGE;else process.env.EVALUATION_PYTHON_IMAGE=previousImage;if(previousBertImage===undefined)delete process.env.EVALUATION_BERTSCORE_IMAGE;else process.env.EVALUATION_BERTSCORE_IMAGE=previousBertImage;if(previousBertEnabled===undefined)delete process.env.EVALUATION_BERTSCORE_ENABLED;else process.env.EVALUATION_BERTSCORE_ENABLED=previousBertEnabled;await fs.rm(dir,{recursive:true,force:true});});
  assert.equal(await pythonMetricAvailable(),true);
  assert.equal(await pythonMetricAvailable('bertscore'),false);
  await assert.rejects(runBertScore('回答','参考'),/容器镜像未就绪/);
  assert.equal(await runPythonMetric('def score(payload): return 0.5',{output:'x'}),0.5);
  await assert.rejects(runPythonMetric('invalid',{output:'x'}),/超出 0–1/);
  await assert.rejects(runPythonMetric('hang',{output:'x'},100),/超过 0 秒时限/);
  const modelServer=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);const judge=body.messages[0].content.includes('评测运行');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:judge?'{"score":4,"reason":"ok"}':'输出'}}],usage:{prompt_tokens:10,completion_tokens:5}}));});
  await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>modelServer.close(resolve)));
  const api=await createPgTestServer(t,undefined,{MODEL_API_BASE_URL:`http://127.0.0.1:${modelServer.address().port}`,MODEL_API_KEY:'test'});
  const login=async(username,password)=>{const response=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});return(await response.json()).token;};
  const admin=await login('admin','admin123'),member=await login('member','test');
  const call=async(token,url,method='GET',body)=>{const response=await fetch(`${api.base}${url}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  assert.equal((await call(member,'/evaluation/metric-scripts','POST',{name:'非法',source:'def score(payload): return 0.5'})).status,403);
  const script=await call(admin,'/evaluation/metric-scripts','POST',{name:'自定义半分',source:'def score(payload): return 0.5'});
  assert.equal(script.status,201,JSON.stringify(script.data));
  const metric=await call(admin,'/experiment-metrics','POST',{name:'自定义指标',ruleType:'custom_python',customScriptId:script.data.id,passThreshold:2.5,regressionThreshold:0.2,judgePrompt:'请评分'});
  assert.equal(metric.status,201,JSON.stringify(metric.data));
  assert.equal((await call(admin,'/evaluation/metrics')).data.pythonEnabled,true);
  const model=(await call(admin,'/experiment-platform/models','POST',{displayName:'Test',apiModel:'test',inputUsdPerMillion:1,outputUsdPerMillion:1})).data;
  await call(admin,'/experiment-platform/config','PUT',{dailyBudgetUsd:10,concurrencyLimit:1,judgeModelId:model.id});
  const definition=(await call(admin,'/experiment-definitions','POST',{title:'Python 评测',systemPrompt:'系统',userPrompt:'{{question}}',variables:{question:'问题'},variants:[{modelId:model.id,label:'A',parameters:{max_tokens:10}}]})).data;
  const dataset=(await call(admin,'/experiment-datasets','POST',{name:'Python 用例',cases:[{caseKey:'case-1',variables:{question:'问题'},referenceAnswer:'参考'}]})).data;
  const batch=await call(admin,`/experiment-definitions/${definition.id}/dataset-run`,'POST',{datasetVersionId:dataset.version.id,metricVersionId:metric.data.id,variantIds:[definition.variants[0].id]});
  assert.equal(batch.status,202,JSON.stringify(batch.data));
  let detail;
  for(let index=0;index<60;index++){await new Promise(resolve=>setTimeout(resolve,100));detail=(await api.client.query('SELECT m.rule_score,m.metric_details FROM experiment_run_metrics m JOIN experiment_runs r ON r.id=m.run_id WHERE r.batch_id=$1',[batch.data.batchId])).rows[0];if(detail)break;}
  assert.equal(Number(detail.rule_score),2.5);
  assert.equal(detail.metric_details.custom_python,0.5);
  process.env.EVALUATION_BERTSCORE_IMAGE='test-image';
  assert.equal(await runBertScore('输出','参考'),0.5);
});
