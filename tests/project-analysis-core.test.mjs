import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProjectEvidence, validateProjectReport } from '../mock/project-analysis-core.mjs';

const files = [
  { path: 'src/app.ts', category: 'source', status: 'read', content: 'export const app = true;\nrun(app);\n', git_sha: 'a'.repeat(40) },
  { path: 'README.md', category: 'documentation', status: 'read', content: '# Project\nLearning app\n', git_sha: 'b'.repeat(40) },
  { path: '.env', category: 'source', status: 'excluded', content: null, git_sha: 'c'.repeat(40) },
];

test('analysis evidence is bounded, line-numbered, and only includes read text', () => {
  const selected = selectProjectEvidence(files, { maxFiles: 2, maxChars: 100, maxCharsPerFile: 60 });
  assert.deepEqual(selected.map(file => file.path), ['README.md', 'src/app.ts']);
  assert.deepEqual(selected[1].lines, ['export const app = true;', 'run(app);']);
  assert.equal(selected[0].numberedContent, '1: # Project\n2: Learning app');
  assert.ok(selected.reduce((sum, file) => sum + file.numberedContent.length, 0) <= 100);
  assert.equal(selected.some(file => file.path === '.env'), false);
});

test('legacy scan content containing a known credential is never selected for a model', () => {
  const legacy = { path: 'src/old.ts', category: 'source', status: 'read', content: 'const key = "sk-' + 'x'.repeat(24) + '";', git_sha: 'd'.repeat(40) };
  assert.deepEqual(selectProjectEvidence([...files, legacy]).map(file => file.path), ['README.md', 'src/app.ts']);
});

test('model report requires exact evidence from selected commit lines', () => {
  const selected = selectProjectEvidence(files);
  const raw = JSON.stringify({ summary: '已发现应用入口', findings: [{ title: '入口模块', status: 'implemented', detail: '包含运行入口', evidence: { path: 'src/app.ts', line: 2, excerpt: 'run(app);' } }], suggestions: [{ topic: '验证运行流程', reason: '需要运行证明', practice: '编写入口测试', acceptance: '测试通过', findingIndex: 0 }] });
  const report = validateProjectReport(raw, selected);
  assert.equal(report.findings[0].evidence.type, 'code');
  assert.equal(report.findings[0].evidence.gitSha, 'a'.repeat(40));
  assert.equal(report.suggestions[0].findingIndex, 0);
  for (const invalid of [
    raw.replace('run(app);', 'made up'),
    raw.replace('src/app.ts', '.env'),
    raw.replace('"line":2', '"line":99'),
    raw.replace('"findingIndex":0', '"findingIndex":5'),
  ]) assert.throws(() => validateProjectReport(invalid, selected), /证据|建议/);
});

test('unsupported model output is rejected rather than saved as a successful report', () => {
  const selected = selectProjectEvidence(files);
  for (const raw of ['```json\n{}\n```', '{broken', JSON.stringify({ summary: 'ok', findings: [], suggestions: [], completionPercent: 100 }), JSON.stringify({ summary: 'ok', findings: [{ title: '猜测', status: 'implemented', detail: '无证据', evidence: null }], suggestions: [] })]) {
    assert.throws(() => validateProjectReport(raw, selected));
  }
});
