import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectModuleCoverage, detectProjectTechnologies, groupProjectEvidence, mergeProjectModuleReports, parseProjectRequirements, selectProjectEvidence, validateProjectReport } from '../mock/project-analysis-core.mjs';

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

test('module plan caps model calls and aggregation keeps each finding and suggestion aligned', () => {
  const many = Array.from({length: 9}, (_,index) => ({ path: `src/module${index}/entry.ts`, category: 'source', status: 'read', content: `export const value${index} = true;`, git_sha: 'a'.repeat(40) }));
  const selected = selectProjectEvidence(many);
  assert.equal(groupProjectEvidence(selected).length, 8);
  assert.equal(selected.length, 8);
  const groups = groupProjectEvidence(selected).slice(0,2);
  const reports = groups.map(({moduleKey,files}) => ({ moduleKey, report: { summary: `已查看 ${moduleKey}`, findings: [{ title: moduleKey, status: 'implemented', requirementId: null, detail: '入口存在', evidence: { path: files[0].path, line: 1, excerpt: files[0].lines[0] } }], suggestions: [{ topic: '测试', reason: '需验证', practice: '编写测试', acceptance: '测试通过', findingIndex: 0, impact: 'medium', impactReason: '缺少测试影响后续重构', prerequisites: ['测试基础'] }] } }));
  const merged = mergeProjectModuleReports(reports);
  assert.deepEqual(merged.findings.map(finding => finding.moduleKey), groups.map(group => group.moduleKey));
  assert.deepEqual(merged.suggestions.map(suggestion => suggestion.findingIndex), [0,1]);
  assert.match(merged.summary, /2 个目录模块/);
});

test('legacy scan content containing a known credential is never selected for a model', () => {
  const legacy = { path: 'src/old.ts', category: 'source', status: 'read', content: 'const key = "sk-' + 'x'.repeat(24) + '";', git_sha: 'd'.repeat(40) };
  assert.deepEqual(selectProjectEvidence([...files, legacy]).map(file => file.path), ['README.md', 'src/app.ts']);
  const legacyPath = { path: '.aws/credentials', category: 'config', status: 'read', content: '[default]\nregion=cn-shanghai', git_sha: 'e'.repeat(40) };
  assert.deepEqual(selectProjectEvidence([...files, legacyPath]).map(file => file.path), ['README.md', 'src/app.ts']);
});

test('technology hints only quote declared dependencies from readable manifests', () => {
  const manifest = { path: 'package.json', status: 'read', content: '{\n  "dependencies": {\n    "react": "^19.0.0",\n    "vite": "^6.0.0"\n  },\n  "scripts": {\n    "express": "not a dependency"\n  }\n}', git_sha: 'e'.repeat(40) };
  const hidden = { path: 'packages/hidden/package.json', status: 'excluded', content: '{"dependencies":{"next":"1"}}', git_sha: 'f'.repeat(40) };
  const detected = detectProjectTechnologies([hidden,manifest]);
  assert.deepEqual(detected.map(item => item.name),['React','Vite']);
  assert.deepEqual(detected[0],{ name: 'React', packageName: 'react', path: 'package.json', line: 3, excerpt: '"react": "^19.0.0",', gitSha: 'e'.repeat(40) });
  assert.deepEqual(detectProjectTechnologies([{ ...manifest, content: '{invalid' }]),[]);
  const ambiguous = manifest.content.replace('"express": "not a dependency"','"react": "not a dependency"');
  assert.deepEqual(detectProjectTechnologies([{ ...manifest, content: ambiguous }]).map(item => item.name),['Vite']);
});

test('technology hints cite Python, Go and Rust dependency lines without treating comments as declarations', () => {
  const files = [
    { path: 'backend/requirements.txt', status: 'read', content: '# django==5\nfastapi==0.115\npandas>=2', gitSha: 'a'.repeat(40) },
    { path: 'api/pyproject.toml', status: 'read', content: '[project]\nname = "api"\ndependencies = [\n  "django>=5",\n]\n[tool.poetry.dependencies]\nflask = "^3"\n[tool.other]\ntorch = "not a dependency"', gitSha: 'd'.repeat(40) },
    { path: 'service/go.mod', status: 'read', content: 'module example.com/service\nrequire (\n  github.com/gin-gonic/gin v1.10.0\n  gorm.io/gorm v1.25.0 // indirect\n)\nreplace github.com/gin-gonic/gin => ../local', gitSha: 'b'.repeat(40) },
    { path: 'worker/Cargo.toml', status: 'read', content: '[package]\nname = "worker"\n[dependencies]\ntokio = { version = "1", features = ["full"] }\naxum = "0.8"\n[features]\nserde = "not a dependency"', gitSha: 'c'.repeat(40) },
  ];
  const found = detectProjectTechnologies(files);
  assert.deepEqual(found.map(item => item.name), ['Axum','Django','FastAPI','Flask','Gin','GORM','pandas','Tokio']);
  assert.deepEqual(found.find(item => item.name === 'Gin'), { name: 'Gin', packageName: 'github.com/gin-gonic/gin', path: 'service/go.mod', line: 3, excerpt: 'github.com/gin-gonic/gin v1.10.0', gitSha: 'b'.repeat(40) });
  assert.equal(found.some(item => item.name === 'PyTorch' || item.name === 'Serde'), false);
});

test('requirement IDs remain stable and ignore fenced examples', () => {
  const first = parseProjectRequirements('REQ-001: 创建任务\n- [ ] 查看任务\n```md\nREQ-999: 示例\n```\nREQ-001: 重复项');
  assert.equal(first.length,2);
  assert.equal(first[0].id,'REQ-001');
  assert.match(first[1].id,/^R-[0-9A-F]{12}$/);
  const reordered = parseProjectRequirements('- [ ] 查看任务\nREQ-001: 创建任务');
  assert.equal(reordered[0].id,first[1].id);
  assert.equal(reordered[1].id,'REQ-001');
});

test('model report requires exact evidence from selected commit lines', () => {
  const selected = selectProjectEvidence(files);
  const raw = JSON.stringify({ summary: '已发现应用入口', findings: [{ title: '入口模块', status: 'implemented', requirementId: null, detail: '包含运行入口', evidence: { path: 'src/app.ts', line: 2, excerpt: 'run(app);' } }], suggestions: [{ topic: '验证运行流程', reason: '需要运行证明', practice: '编写入口测试', acceptance: '测试通过', findingIndex: 0, impact: 'high', impactReason: '缺少运行证据会影响后续部署', prerequisites: ['集成测试'] }] });
  const report = validateProjectReport(raw, selected);
  assert.equal(report.findings[0].evidence.type, 'code');
  assert.equal(report.findings[0].evidence.gitSha, 'a'.repeat(40));
  assert.equal(report.suggestions[0].findingIndex, 0);
  assert.equal(report.suggestions[0].impact,'high');
  const requirementLinked = JSON.parse(raw);
  requirementLinked.findings[0].requirementId = 'REQ-001';
  assert.equal(validateProjectReport(JSON.stringify(requirementLinked),selected,{ requirementIds: ['REQ-001'] }).findings[0].requirementId,'REQ-001');
  assert.throws(() => validateProjectReport(JSON.stringify(requirementLinked),selected,{ requirementIds: ['REQ-002'] }),/需求关联/);
  for (const invalid of [
    raw.replace('run(app);', 'made up'),
    raw.replace('src/app.ts', '.env'),
    raw.replace('"line":2', '"line":99'),
    raw.replace('"findingIndex":0', '"findingIndex":5'),
    raw.replace('"impact":"high"', '"impact":"urgent"'),
    raw.replace('"prerequisites":["集成测试"]', '"prerequisites":["集成测试","集成测试"]'),
  ]) assert.throws(() => validateProjectReport(invalid, selected), /证据|建议/);
});

test('core flow steps require ordered source or test lines from the selected commit', () => {
  const selected = selectProjectEvidence(files);
  const valid = { summary: '入口流程线索', findings: [{ title: '入口', status: 'unverified', detail: '仍需运行验证', evidence: null, requirementId: null }], suggestions: [], flows: [{ title: '启动流程', steps: [
    { description: '导出应用', evidence: { path: 'src/app.ts', line: 1, excerpt: 'export const app = true;' } },
    { description: '调用应用', evidence: { path: 'src/app.ts', line: 2, excerpt: 'run(app);' } },
  ] }] };
  const parsed = validateProjectReport(JSON.stringify(valid),selected);
  assert.equal(parsed.flows[0].steps[1].evidence.gitSha,'a'.repeat(40));
  assert.equal(parsed.flows[0].steps[1].evidence.type,'code');
  assert.deepEqual(mergeProjectModuleReports([{ moduleKey: 'src', report: parsed }]).flows[0].moduleKey,'src');
  for (const invalid of [
    { ...valid, flows: [{ ...valid.flows[0], steps: valid.flows[0].steps.slice(0,1) }] },
    { ...valid, flows: [{ ...valid.flows[0], steps: [{ ...valid.flows[0].steps[0], evidence: { path: 'README.md', line: 2, excerpt: 'Learning app' } }, valid.flows[0].steps[1]] }] },
    { ...valid, flows: [{ ...valid.flows[0], steps: [{ ...valid.flows[0].steps[0], evidence: { path: 'src/app.ts', line: 1, excerpt: 'invented' } }, valid.flows[0].steps[1]] }] },
  ]) assert.throws(() => validateProjectReport(JSON.stringify(invalid),selected),/核心流程/);
  assert.deepEqual(validateProjectReport(JSON.stringify({ ...valid, flows: undefined }),selected).flows,[]);
});

test('unsupported model output is rejected rather than saved as a successful report', () => {
  const selected = selectProjectEvidence(files);
  for (const raw of ['```json\n{}\n```', '{broken', JSON.stringify({ summary: 'ok', findings: [], suggestions: [], completionPercent: 100 }), JSON.stringify({ summary: 'ok', findings: [{ title: '猜测', status: 'implemented', requirementId: null, detail: '无证据', evidence: null }], suggestions: [] })]) {
    assert.throws(() => validateProjectReport(raw, selected));
  }
});

test('documentation claims cannot prove implementation and absence has no positive line evidence', () => {
  const selected = selectProjectEvidence(files);
  const base = { summary: '待验证', findings: [{ title: '功能', status: 'implemented', requirementId: null, detail: '文档声称存在', evidence: { path: 'README.md', line: 2, excerpt: 'Learning app' } }], suggestions: [] };
  assert.throws(() => validateProjectReport(JSON.stringify(base), selected), /文档|证据/);
  base.findings[0] = { title: '未发现', status: 'not_found', requirementId: null, detail: '扫描范围内未见实现', evidence: { path: 'src/app.ts', line: 1, excerpt: 'export const app = true;' } };
  assert.throws(() => validateProjectReport(JSON.stringify(base), selected), /证据/);
});
