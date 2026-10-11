import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPublicRepository } from '../mock/project-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tests/fixtures/project-analysis-sample');
const env = { ...process.env, GIT_AUTHOR_NAME: 'Project Sample', GIT_AUTHOR_EMAIL: 'sample@example.invalid', GIT_COMMITTER_NAME: 'Project Sample', GIT_COMMITTER_EMAIL: 'sample@example.invalid' };
const git = (cwd,args,extra={}) => execFileSync('git',args,{ cwd, env: { ...env,...extra }, encoding: 'utf8' }).trim();

export function createProjectSampleRepository() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'admin-project-sample-'));
  fs.cpSync(path.join(root,'current'),directory,{ recursive: true });
  git(directory,['init','-q']);
  git(directory,['config','core.autocrlf','false']);
  fs.mkdirSync(path.join(directory,'src'),{recursive:true});
  fs.copyFileSync(path.join(root,'prior/src/archive.js'),path.join(directory,'src/archive.js'));
  git(directory,['add','.']);
  git(directory,['commit','-q','-m','sample prior'],{ GIT_AUTHOR_DATE: '2025-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2025-01-01T00:00:00Z' });
  const priorCommit = git(directory,['rev-parse','HEAD']);
  fs.unlinkSync(path.join(directory,'src/archive.js'));
  git(directory,['add','-A']);
  git(directory,['commit','-q','-m','sample current'],{ GIT_AUTHOR_DATE: '2025-01-02T00:00:00Z', GIT_COMMITTER_DATE: '2025-01-02T00:00:00Z' });
  const currentCommit = git(directory,['rev-parse','HEAD']);
  return { directory, priorCommit, currentCommit, cleanup: () => fs.rmSync(directory,{ recursive: true, force: true }) };
}

export async function scanProjectSample(sample) {
  const treeSha = git(sample.directory,['rev-parse',`${sample.currentCommit}^{tree}`]);
  const entries = execFileSync('git',['ls-tree','-r','-l','-z',sample.currentCommit],{cwd:sample.directory}).toString('utf8').split('\0').filter(Boolean).map(line => {
    const match = line.match(/^(\d+) blob ([0-9a-f]{40})\s+(\d+)\t(.+)$/);
    if (!match) throw new Error(`样例树对象无效: ${line}`);
    return { mode: match[1], type: 'blob', sha: match[2], size: Number(match[3]), path: match[4] };
  });
  const json = value => ({ ok: true, status: 200, json: async () => value });
  const fetchGithub = async url => {
    if (url.endsWith(`/git/commits/${sample.currentCommit}`)) return json({ tree: { sha: treeSha } });
    if (url.endsWith(`/git/trees/${treeSha}?recursive=1`)) return json({ tree: entries, truncated: false });
    const sha = url.match(/\/git\/blobs\/([0-9a-f]{40})$/)?.[1];
    if (sha && entries.some(entry => entry.sha === sha)) return json({ encoding: 'base64', content: execFileSync('git',['cat-file','blob',sha],{cwd:sample.directory}).toString('base64') });
    throw new Error(`样例 GitHub 请求无效: ${url}`);
  };
  return scanPublicRepository({ fullName: 'sample/project-analysis', commitSha: sample.currentCommit, fetchGithub });
}

export function evaluateProjectSample(report, labels, scan) {
  if (!Array.isArray(report?.findings) || !Array.isArray(report?.suggestions) || !Array.isArray(labels?.cases)) throw new Error('报告或人工标签结构无效');
  const files = new Map(scan.files.filter(file => file.status === 'read').map(file => [file.path,file]));
  const results = labels.cases.map(label => {
    const findings = (report.findings || []).filter(item => item.requirementId === label.requirementId);
    const statuses = [...new Set(findings.map(item => item.status))];
    const statusMatch = statuses.length === 1 && statuses[0] === label.expectedStatus;
    const invalidEvidence = findings.filter(finding => {
      if (!finding.evidence) return ['implemented','partial'].includes(finding.status);
      const file = files.get(finding.evidence.path);
      const line = file?.content?.split(/\r?\n/)[finding.evidence.line - 1];
      return !file || file.gitSha !== finding.evidence.gitSha || !line || line.trim() !== finding.evidence.excerpt?.trim();
    }).length;
    const suggestionPresent = !label.suggestionRequired || (report.suggestions || []).some(suggestion => findings.some(finding => finding.id === suggestion.findingId) && suggestion.practice?.trim() && suggestion.acceptance?.trim());
    return { requirementId: label.requirementId, expectedStatus: label.expectedStatus, actualStatuses: statuses, missing: findings.length === 0, statusMatch, invalidEvidence, suggestionPresent, falsePositive: ['not_found','unverified'].includes(label.expectedStatus) && statuses.some(status => ['implemented','partial'].includes(status)), falseNegative: ['implemented','partial'].includes(label.expectedStatus) && (findings.length === 0 || statuses.every(status => ['not_found','unverified'].includes(status))) };
  });
  const unlabelled = (report.findings || []).filter(item => item.requirementId && !labels.cases.some(label => label.requirementId === item.requirementId)).length;
  const totals = { cases: results.length, missing: results.filter(row => row.missing).length, statusMismatches: results.filter(row => !row.statusMatch).length, invalidEvidence: results.reduce((sum,row) => sum + row.invalidEvidence,0), missingSuggestions: results.filter(row => !row.suggestionPresent).length, falsePositives: results.filter(row => row.falsePositive).length, falseNegatives: results.filter(row => row.falseNegative).length, unlabelled };
  return { commitMatches: report.commitSha === scan.commitSha, scanComplete: scan.coverageComplete === true, totals, results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input) { process.stderr.write('用法：node scripts/project-analysis-benchmark.mjs <报告 JSON 路径>\n'); process.exitCode = 2; }
  else {
    const sample = createProjectSampleRepository();
    try {
      const scan = await scanProjectSample(sample);
      const report = JSON.parse(fs.readFileSync(input,'utf8'));
      const labels = JSON.parse(fs.readFileSync(path.join(root,'labels.json'),'utf8'));
      const outcome = evaluateProjectSample(report,labels,scan);
      process.stdout.write(`${JSON.stringify({ sampleCommit: sample.currentCommit, ...outcome },null,2)}\n`);
      if (!outcome.commitMatches || !outcome.scanComplete || Object.entries(outcome.totals).some(([key,value]) => key !== 'cases' && value > 0)) process.exitCode = 1;
    } finally { sample.cleanup(); }
  }
}
