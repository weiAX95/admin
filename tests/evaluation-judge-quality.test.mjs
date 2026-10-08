import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJudge } from '../mock/experiment-scoring.mjs';
import { judgeQuality, pearson } from '../mock/evaluation-judge-quality.mjs';

test('judge accepts four bounded dimensions while preserving legacy 0–5 responses', () => {
  const parsed=parseJudge(JSON.stringify({dimensions:{accuracy:8,completeness:6,conciseness:10,safety:8},reason:'依据充分'}));
  assert.equal(parsed.score,4);
  assert.equal(parsed.dimensions.conciseness,10);
  assert.equal(parseJudge('{"score":3,"reason":"旧格式"}').score,3);
  assert.throws(()=>parseJudge('{"dimensions":{"accuracy":11,"completeness":4,"conciseness":4,"safety":4}}'),/四维/);
});

test('Pearson correlation is reported overall and per human rubric dimension', () => {
  assert.equal(pearson([[1,2],[2,4],[3,6]]),1);
  assert.equal(pearson([[1,1]]),null);
  const rows=[2,4,6,8].map(value=>({judgeScore:value/2,judgeDimensions:{accuracy:value,completeness:value,conciseness:value,safety:value},human:{accuracy:value,completeness:value,brevity:value,safety:value}}));
  const quality=judgeQuality(rows);
  assert.equal(quality.count,4);
  assert.equal(quality.overallPearson,1);
  assert.equal(quality.dimensions.conciseness.pearson,1);
  assert.equal(quality.thresholdMet,true);
  assert.equal(judgeQuality([]).thresholdMet,null);
});
