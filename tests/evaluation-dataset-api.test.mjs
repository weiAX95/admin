import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPgTestServer } from './pg-helper.mjs';

test('folder, structured import and immutable subset share stable case keys', async t => {
  const api = await createPgTestServer(t);
  const login = await fetch(`${api.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const token = (await login.json()).token;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${api.base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const folder = await request('/evaluation/folders', 'POST', { name: '中文评测' });
  assert.equal(folder.status, 201);
  const cases = Array.from({ length: 100 }, (_, index) => ({ caseKey: `case-${index}`, input: `问题 ${index}`, expectedOutput: '答案', context: [{ role: 'system', parts: [{ type: 'text', text: '简洁回答' }] }], tags: ['基础'], difficulty: 2, source: 'qa_import' }));
  const dataset = await request('/experiment-datasets', 'POST', { name: '批量导入', folderId: folder.data.id, cases });
  assert.equal(dataset.status, 201, JSON.stringify(dataset.data));
  const version = await request(`/experiment-dataset-versions/${dataset.data.version.id}`);
  assert.equal(version.data.cases.length, 100);
  assert.equal(version.data.cases[0].input_payload.parts[0].type, 'text');
  assert.deepEqual(version.data.cases[0].tags, ['基础']);
  const subset = await request(`/evaluation/datasets/${dataset.data.id}/subset`, 'POST', { name: '小子集', versionId: dataset.data.version.id, caseKeys: ['case-0', 'case-1'] });
  assert.equal(subset.status, 201, JSON.stringify(subset.data));
  const subsetVersion = await request(`/experiment-dataset-versions/${subset.data.version.id}`);
  assert.deepEqual(subsetVersion.data.cases.map(item => item.case_key), ['case-0', 'case-1']);
  const bad = await request('/experiment-datasets', 'POST', { name: '坏附件', cases: [{ caseKey: 'x', input: { parts: [{ type: 'image', assetId: 'missing' }] } }] });
  assert.equal(bad.status, 400);
  assert.ok(!(await request('/experiment-datasets')).data.items.some(item => item.name === '坏附件'));
});

test('one immutable version accepts exactly 10,000 cases', async t => {
  const api = await createPgTestServer(t);
  const response = await fetch(`${api.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const token = (await response.json()).token;
  const cases = Array.from({ length: 10000 }, (_, index) => ({ caseKey: `bulk-${index}`, input: `问题 ${index}` }));
  const created = await fetch(`${api.base}/experiment-datasets`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '10k', cases }) });
  assert.equal(created.status, 201, JSON.stringify(await created.json()));
  const count = await api.client.query("SELECT count(*)::integer AS n FROM experiment_dataset_cases c JOIN experiment_dataset_versions v ON v.id=c.dataset_version_id JOIN experiment_datasets d ON d.id=v.dataset_id WHERE d.name='10k'");
  assert.equal(count.rows[0].n, 10000);
});
