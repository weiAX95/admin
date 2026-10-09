import test from 'node:test';
import assert from 'node:assert/strict';
import { scanPublicRepository } from '../mock/project-scan.mjs';

const SHA = 'a'.repeat(40), TREE = 'b'.repeat(40);
const json = value => ({ ok: true, status: 200, json: async () => value });
const blob = text => ({ content: Buffer.from(text).toString('base64'), encoding: 'base64', size: Buffer.byteLength(text) });

test('scanner pins one commit, expands truncated trees and excludes secrets before blob requests', async () => {
  const calls = [];
  const get = async url => {
    calls.push(url);
    if (url.endsWith(`/git/commits/${SHA}`)) return json({ tree: { sha: TREE } });
    if (url.endsWith(`/git/trees/${TREE}?recursive=1`)) return json({ truncated: true, tree: [{ path: 'src/app.ts', type: 'blob', sha: 'c'.repeat(40), size: 19 }] });
    if (url.endsWith(`/git/trees/${TREE}`)) return json({ truncated: false, tree: [
      { path: 'src', type: 'tree', sha: 'd'.repeat(40) },
      { path: '.env', type: 'blob', sha: 'e'.repeat(40), size: 30 },
    ] });
    if (url.endsWith(`/git/trees/${'d'.repeat(40)}`)) return json({ truncated: false, tree: [
      { path: 'app.ts', type: 'blob', sha: 'c'.repeat(40), size: 19 },
      { path: 'huge.ts', type: 'blob', sha: 'f'.repeat(40), size: 900000 },
    ] });
    if (url.endsWith(`/git/blobs/${'c'.repeat(40)}`)) return json(blob('export const x = 1;'));
    throw new Error(`unexpected ${url}`);
  };
  const result = await scanPublicRepository({ fullName: 'octocat/example', commitSha: SHA, fetchGithub: get });
  assert.equal(result.treeSha, TREE);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.files.find(file => file.path === 'src/app.ts').status, 'read');
  assert.equal(result.files.find(file => file.path === '.env').status, 'excluded');
  assert.equal(result.files.find(file => file.path === 'src/huge.ts').status, 'excluded');
  assert.equal(result.readCount, 1);
  assert.ok(!calls.some(url => url.includes(`/git/blobs/${'e'.repeat(40)}`)));
  assert.ok(calls.every(url => url.includes('/repos/octocat/example/git/')));
});

test('scanner records blob failures and refuses to claim complete coverage', async () => {
  const get = async url => {
    if (url.endsWith(`/git/commits/${SHA}`)) return json({ tree: { sha: TREE } });
    if (url.includes('/git/trees/')) return json({ truncated: false, tree: [{ path: 'README.md', type: 'blob', sha: 'c'.repeat(40), size: 5 }] });
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const result = await scanPublicRepository({ fullName: 'octocat/example', commitSha: SHA, fetchGithub: get });
  assert.equal(result.coverageComplete, false);
  assert.equal(result.files[0].status, 'failed');
  assert.equal(result.failedCount, 1);
});

test('scanner stops new blob calls after rate limit and marks remaining files unscanned', async () => {
  let blobCalls = 0;
  const get = async url => {
    if (url.endsWith(`/git/commits/${SHA}`)) return json({ tree: { sha: TREE } });
    if (url.includes('/git/trees/')) return json({ truncated: false, tree: [
      { path: 'a.ts', type: 'blob', sha: 'c'.repeat(40), size: 1 },
      { path: 'b.ts', type: 'blob', sha: 'd'.repeat(40), size: 1 },
    ] });
    blobCalls++;
    return { ok: false, status: 429, json: async () => ({}) };
  };
  const result = await scanPublicRepository({ fullName: 'octocat/example', commitSha: SHA, fetchGithub: get });
  assert.equal(blobCalls, 1);
  assert.deepEqual(result.files.map(file => file.status), ['failed', 'unscanned']);
  assert.equal(result.coverageComplete, false);
});
