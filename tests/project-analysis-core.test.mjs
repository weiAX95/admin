import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectModuleCoverage, selectProjectEvidence, validateProjectReport } from '../mock/project-analysis-core.mjs';

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

test('evidence selection spreads a small budget across modules and reports omitted scope', () => {
  const scoped = [
    { path: 'src/api/a.ts', category: 'source', status: 'read', content: 'export const a = 1;', git_sha: 'a'.repeat(40) },
    { path: 'src/api/b.ts', category: 'source', status: 'read', content: 'export const b = 2;', git_sha: 'b'.repeat(40) },
    { path: 'src/pages/home.ts', category: 'source', status: 'read', content: 'export const home = 1;', git_sha: 'c'.repeat(40) },
    { path: 'src/pages/about.ts', category: 'source', status: 'read', content: 'export const about = 1;', git_sha: 'd'.repeat(40) },
    { path: 'tests/api.test.ts', category: 'test', status: 'unscanned', content: null, git_sha: 'e'.repeat(40) },
  ];
  const selected = selectProjectEvidence(scoped, { maxFiles: 2 });
  assert.deepEqual(selected.map(file => file.path), ['src/api/a.ts','src/pages/about.ts']);
  assert.deepEqual(buildProjectModuleCoverage(scoped,selected), [
    { moduleKey: 'src/api', indexedCount: 2, readCount: 2, selectedCount: 1, truncatedCount: 0, excludedCount: 0, failedCount: 0, unscannedCount: 0 },
    { moduleKey: 'src/pages', indexedCount: 2, readCount: 2, selectedCount: 1, truncatedCount: 0, excludedCount: 0, failedCount: 0, unscannedCount: 0 },
    { moduleKey: 'tests', indexedCount: 1, readCount: 0, selectedCount: 0, truncatedCount: 0, excludedCount: 0, failedCount: 0, unscannedCount: 1 },
  ]);
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

test('documentation claims cannot prove implementation and absence has no positive line evidence', () => {
  const selected = selectProjectEvidence(files);
  const base = { summary: '待验证', findings: [{ title: '功能', status: 'implemented', detail: '文档声称存在', evidence: { path: 'README.md', line: 2, excerpt: 'Learning app' } }], suggestions: [] };
  assert.throws(() => validateProjectReport(JSON.stringify(base), selected), /文档|证据/);
  base.findings[0] = { title: '未发现', status: 'not_found', detail: '扫描范围内未见实现', evidence: { path: 'src/app.ts', line: 1, excerpt: 'export const app = true;' } };
  assert.throws(() => validateProjectReport(JSON.stringify(base), selected), /证据/);
});
