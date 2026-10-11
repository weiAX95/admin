import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createPgTestServer } from './pg-helper.mjs';
import { scanPublicRepository } from '../mock/project-scan.mjs';
import { runProjectScan } from '../mock/project-scan-jobs.mjs';

const commitSha = 'a'.repeat(40), treeSha = 'b'.repeat(40), fileSha = 'c'.repeat(40);
const content = 'export const x = 1;';
const entries = Array.from({ length: 10000 }, (_, index) => ({ path: `src/file-${String(index).padStart(5, '0')}.ts`, type: 'blob', sha: fileSha, size: Buffer.byteLength(content) }));
const response = value => ({ ok: true, status: 200, json: async () => value });
const fetchGithub = async url => url.includes('/commits/') ? response({ tree: { sha: treeSha } })
  : url.includes('/trees/') ? response({ truncated: false, tree: entries })
    : response({ content: Buffer.from(content).toString('base64'), encoding: 'base64' });

test('10k-entry tree indexes 5k rows, reads 200 blobs and persists explicit partial coverage', async t => {
  const { client } = await createPgTestServer(t);
  const repositoryId = crypto.randomUUID(), scanId = crypto.randomUUID();
  await client.query("INSERT INTO project_repositories(id,owner_id,full_name,branch,goal,commit_sha) VALUES($1,'member','sample/large','main','量测扫描',$2)", [repositoryId,commitSha]);
  await client.query("INSERT INTO project_scans(id,repository_id,full_name,branch,commit_sha,status) VALUES($1,$2,'sample/large','main',$3,'queued')", [scanId,repositoryId,commitSha]);
  let scannerMs = 0;
  const started = performance.now();
  await runProjectScan(client, scanId, async args => {
    const scanStarted = performance.now();
    const result = await scanPublicRepository({ ...args, fetchGithub });
    scannerMs = performance.now() - scanStarted;
    return result;
  });
  const totalMs = performance.now() - started;
  const scan = (await client.query('SELECT status,coverage_complete,read_count,unscanned_count FROM project_scans WHERE id=$1', [scanId])).rows[0];
  const count = (await client.query('SELECT count(*)::int AS n FROM project_scan_files WHERE scan_id=$1', [scanId])).rows[0].n;
  assert.deepEqual(scan, { status: 'partial', coverage_complete: false, read_count: 200, unscanned_count: 9800 });
  assert.equal(count, 5000);
  console.log(JSON.stringify({ machine: 'local developer workstation', source: 'synthetic GitHub API responses; no network latency', treeEntries: 10000, indexedRows: count, blobReads: scan.read_count, scannerMs: Math.round(scannerMs), totalWithPostgresMs: Math.round(totalMs) }));
});
