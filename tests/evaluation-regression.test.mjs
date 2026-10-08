import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degradedRunMetrics, normalizedScores } from '../mock/evaluation-regression.mjs';
import { DEFAULT_GOAL_RANGES } from '../mock/evaluation-ranking.mjs';

const row=(caseKey,values={})=>({case_key:caseKey,status:'completed',variables:{},input_payload:{parts:[{type:'text',text:caseKey}]},context_payload:[],difficulty:'2',category:'基础',auto_score:4,latency_ms:1000,completion_tokens:100,metric_details:{exact:1,token_f1:1},passed:true,...values});
test('per-metric regression uses fixed goal ranges, exact threshold and stable input',()=>{
  const old=[row('a'),row('b')];
  const current=[row('a',{auto_score:2,latency_ms:8000,metric_details:{exact:0,token_f1:0.8},passed:false}),row('b',{input_payload:{parts:[{type:'text',text:'changed'}]},auto_score:0,metric_details:{exact:0}})];
  const result=degradedRunMetrics(current,old,DEFAULT_GOAL_RANGES,0.2);
  assert.deepEqual(result.map(item=>item.metric),['exact','latency','accuracy']);
  assert.ok(result.every(item=>item.caseKey==='a'&&item.affectedPassRate));
  assert.equal(result[0].drop,1);
  assert.equal(normalizedScores(row('a',{latency_ms:0}),DEFAULT_GOAL_RANGES).latency,1);
  assert.deepEqual(degradedRunMetrics([row('a',{metric_details:{exact:0.8,token_f1:0.8}})],[row('a')],DEFAULT_GOAL_RANGES,0.2),[]);
});
