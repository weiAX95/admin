import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectSampleRepository, evaluateProjectSample, scanProjectSample } from '../scripts/project-analysis-benchmark.mjs';
import { parseProjectRequirements, selectProjectEvidence, validateProjectReport } from '../mock/project-analysis-core.mjs';

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'fixtures/project-analysis-sample');

test('fixed two-commit sample covers six labelled cases and detects misleading reports', async t => {
  const sample = createProjectSampleRepository();
  t.after(sample.cleanup);
  const scan = await scanProjectSample(sample);
  assert.equal(scan.coverageComplete,true);
  assert.equal(scan.commitSha,sample.currentCommit);
  assert.notEqual(sample.priorCommit,sample.currentCommit);
  assert.equal(scan.files.some(file => file.path === 'src/archive.js'),false);
  const selected = selectProjectEvidence(scan.files);
  const labels = JSON.parse(fs.readFileSync(path.join(fixtureRoot,'labels.json'),'utf8'));
  const requirements = parseProjectRequirements(scan.files.find(file => file.path === 'requirements.md').content);
  assert.deepEqual(requirements.map(item => item.id),labels.cases.map(item => item.requirementId));
  const findings = labels.cases.map(label => {
    const file = scan.files.find(item => item.path === label.evidencePath);
    return { title: label.requirementId, status: label.expectedStatus, requirementId: label.requirementId, detail: label.scenario, evidence: file ? { path: file.path, line: label.evidenceLine, excerpt: file.content.split(/\r?\n/)[label.evidenceLine - 1] } : null };
  });
  const suggestions = labels.cases.flatMap((label,index) => label.suggestionRequired ? [{ topic: `处理 ${label.requirementId}`, reason: label.scenario, practice: '补齐实现与测试', acceptance: '人工复核通过', findingIndex: index, impact: 'medium', impactReason: '影响后续功能验收', prerequisites: ['测试基础'] }] : []);
  const validated = validateProjectReport(JSON.stringify({ summary: '固定样例人工报告', findings, suggestions }),selected,{ requirementIds: requirements.map(item => item.id) });
  const persisted = { commitSha: sample.currentCommit, findings: validated.findings.map((finding,index) => ({ ...finding, id: `finding-${index}` })), suggestions: validated.suggestions.map(item => ({ ...item, findingId: `finding-${item.findingIndex}` })) };
  const clean = evaluateProjectSample(persisted,labels,scan);
  assert.deepEqual(clean.totals,{ cases: 6, missing: 0, statusMismatches: 0, invalidEvidence: 0, missingSuggestions: 0, falsePositives: 0, falseNegatives: 0, unlabelled: 0 });
  assert.equal(clean.commitMatches,true);
  assert.equal(clean.scanComplete,true);
  assert.equal(evaluateProjectSample(persisted,labels,{...scan,coverageComplete:false}).scanComplete,false);
  const misleading = structuredClone(persisted);
  misleading.commitSha = sample.priorCommit;
  misleading.findings.find(item => item.requirementId === 'REQ-004').status = 'implemented';
  misleading.findings.find(item => item.requirementId === 'REQ-001').evidence.path = 'src/archive.js';
  misleading.findings = misleading.findings.filter(item => item.requirementId !== 'REQ-003');
  misleading.suggestions = misleading.suggestions.filter(item => item.findingId !== 'finding-4');
  const scored = evaluateProjectSample(misleading,labels,scan);
  assert.equal(scored.commitMatches,false);
  assert.equal(scored.totals.falsePositives,1);
  assert.equal(scored.totals.missing,1);
  assert.ok(scored.totals.invalidEvidence >= 1);
  assert.ok(scored.totals.missingSuggestions >= 1);
});
