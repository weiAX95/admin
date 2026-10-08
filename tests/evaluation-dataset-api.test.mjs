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
  assert.equal((await request('/evaluation/settings')).status,200);
  assert.equal((await request('/evaluation/settings','PUT',{globalMediaBytes:64,datasetMediaBytes:20,minFreePercent:20})).status,200);
  const media=await fetch(`${api.base}/prompt-media`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-Media-Kind':'image','Content-Type':'image/gif'},body:Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=','base64')});
  assert.equal(media.status,201);
  const asset=(await media.json()).id;
  const over=await request('/experiment-datasets','POST',{name:'超配额',cases:[{caseKey:'x',input:{parts:[{type:'image',assetId:asset}]}}]});
  assert.equal(over.status,400);
  assert.match(over.data.error,/配额/);
  await request('/evaluation/settings','PUT',{globalMediaBytes:1024,datasetMediaBytes:1024,minFreePercent:20});
  assert.equal((await request('/experiment-datasets','POST',{name:'配额内',cases:[{caseKey:'x',input:{parts:[{type:'image',assetId:asset}]}}]})).status,201);
  const memberLogin=await fetch(`${api.base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'member',password:'test'})});
  const memberToken=(await memberLogin.json()).token;
  const memberRequest=async(path,method='GET',body)=>{const response=await fetch(`${api.base}${path}`,{method,headers:{Authorization:`Bearer ${memberToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  assert.equal((await memberRequest('/evaluation/settings','PUT',{globalMediaBytes:1,datasetMediaBytes:1,minFreePercent:0})).status,403);
  const foreign=await memberRequest('/experiment-datasets','POST',{name:'外部附件',cases:[{caseKey:'x',input:{parts:[{type:'image',assetId:asset}]}}]});
  assert.equal(foreign.status,400);
  assert.match(foreign.data.error,/无权引用/);
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
