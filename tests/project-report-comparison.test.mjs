import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProjectReports } from '../mock/project-report-comparison.mjs';

const base = { meta: { id: 'old' }, branch: 'main', baselineVersionId: 'v1', goal: '学习', analysisCoverageComplete: true, selectedFileCount: 2, availableFileCount: 2, suggestions: [] };
const finding = (requirementId, status) => ({ requirementId, title: '入口', status, detail: '证据', evidence: null });

test('comparison refuses ambiguous finding matches and labels partial coverage as limited', () => {
  const older = { ...base, findings: [finding('REQ-1','not_found'),finding('REQ-1','partial')] };
  const newer = { ...base, meta: { id: 'new' }, findings: [finding('REQ-1','implemented')] };
  assert.deepEqual(compareProjectReports(older,newer).changes,[]);
  const limited = compareProjectReports({ ...older, findings: [finding('REQ-1','not_found')] },{ ...newer, analysisCoverageComplete: false });
  assert.equal(limited.comparable,false);
  assert.equal(limited.changes[0].kind,'completion_signal');
  assert.ok(limited.limitations.some(item => item.includes('部分')));
});

test('comparison does not align findings across requirement baseline versions', () => {
  const older = { ...base, findings: [finding('REQ-1','not_found')] };
  const newer = { ...base, meta: { id: 'new' }, baselineVersionId: 'v2', findings: [finding('REQ-1','implemented')] };
  const result = compareProjectReports(older,newer);
  assert.equal(result.comparable,false);
  assert.deepEqual(result.changes,[]);
});
