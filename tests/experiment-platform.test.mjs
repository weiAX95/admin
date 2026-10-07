import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPgTestServer } from './pg-helper.mjs';
import { EXPERIMENT_TEMPLATES, fillPrompt, validateDefinition, validateParameters, winRates } from '../mock/experiment-core.mjs';
import { combineScores, parseJudge, ruleScore } from '../mock/experiment-scoring.mjs';

test('variables, parameters and shared wins obey their contracts', () => {
  assert.equal(fillPrompt('{{name}} + {{name}}', { name: 'A' }), 'A + A');
  assert.throws(() => fillPrompt('{{name}}', {}), /变量未填写/);
  assert.deepEqual(validateParameters({ temperature: 0.7, max_tokens: 100 }), { temperature: 0.7, max_tokens: 100 });
  assert.throws(() => validateParameters({ top_p: 2 }), /无效/);
  const result = winRates([
    { inputIndex: 0, variantId: 'a', status: 'completed', autoScore: 4 },
    { inputIndex: 0, variantId: 'b', status: 'completed', autoScore: 4 },
    { inputIndex: 1, variantId: 'a', status: 'failed', autoScore: null },
    { inputIndex: 1, variantId: 'b', status: 'completed', autoScore: 5 },
  ]);
  assert.equal(result.included, 1); assert.equal(result.excluded, 1);
  assert.equal(result.variants.length, 2);
  assert.deepEqual(winRates([{inputIndex:0,variantId:'a',status:'completed',autoScore:5},{inputIndex:0,variantId:'b',status:'completed',autoScore:2}]).variants.map(item=>item.rate),[1,0]);
  assert.equal(EXPERIMENT_TEMPLATES.length, 5);
  const template = EXPERIMENT_TEMPLATES[0];
  const first = validateDefinition({ title: 'first', systemPrompt: template.systemPrompt, userPrompt: template.userPrompt, variables: {}, variants: template.variants.map(variant => ({ ...variant, modelId: 'model' })) }, new Set(['model']));
  const second = validateDefinition({ title: 'second', systemPrompt: template.systemPrompt, userPrompt: template.userPrompt, variables: {}, variants: template.variants.map(variant => ({ ...variant, modelId: 'model' })) }, new Set(['model']));
  assert.notEqual(first.variants[0].id, second.variants[0].id);
  first.variants[0].parameters.temperature = 1;
  assert.notEqual(template.variants[0].parameters.temperature, 1);
  assert.equal(ruleScore('hello world', 'hello world', 'exact'), 5);
  assert.equal(combineScores(5, 3), 4);
  assert.deepEqual(parseJudge('{"score":4,"reason":"ok"}'), { score: 4, reason: 'ok' });
});

test('definition save, execution, model request and price snapshot persist', async t => {
  const received = [];
  const modelServer = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    received.push({ headers: req.headers, body: JSON.parse(raw) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const judge = received.at(-1).body.messages[0].content.includes('根据问题');
    res.end(JSON.stringify({ choices: [{ message: { content: judge ? '{"score":4,"reason":"准确"}' : '完成' } }], usage: judge ? { prompt_tokens: 10, completion_tokens: 5 } : { prompt_tokens: 100, completion_tokens: 20 } }));
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => modelServer.close(resolve)));
  const api = await createPgTestServer(t, undefined, { MODEL_API_BASE_URL: `http://127.0.0.1:${modelServer.address().port}`, MODEL_API_KEY: 'test-key' });
  const login = await fetch(`${api.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const { token } = await login.json();
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${api.base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const model = await request('/experiment-platform/models', 'POST', { displayName: 'Test', apiModel: 'test-model', inputUsdPerMillion: 2, outputUsdPerMillion: 4 });
  assert.equal(model.status, 201);
  const settings = await request('/experiment-platform/config', 'PUT', { dailyBudgetUsd: 1, concurrencyLimit: 2, judgeModelId: model.data.id });
  assert.equal(settings.status, 200);
  const saved = await request('/experiment-definitions', 'POST', { title: '变量实验', systemPrompt: '系统', userPrompt: '你好 {{name}}', variables: {}, variants: [{ modelId: model.data.id, label: 'A', parameters: { temperature: 0.3, max_tokens: 100 } }] });
  assert.equal(saved.status, 201);
  assert.equal(saved.data.variants.length, 1);
  const missing = await request(`/experiment-definitions/${saved.data.id}/run`, 'POST', { variables: {} });
  assert.equal(missing.status, 400);
  const run = await request(`/experiment-definitions/${saved.data.id}/run`, 'POST', { variables: { name: '世界' } });
  assert.equal(run.status, 202);
  let batch;
  for (let index = 0; index < 40; index++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    batch = (await request(`/experiment-batches/${run.data.batchId}`)).data;
    if (batch.status === 'completed') break;
  }
  assert.equal(batch.status, 'completed');
  assert.equal(received[0].headers.authorization, 'Bearer test-key');
  assert.equal(received[0].body.messages[1].content, '你好 世界');
  assert.equal(received[0].body.temperature, 0.3);
  assert.equal(batch.runs[0].costUsd, 0.00032);
  assert.equal(batch.runs[0].autoScore, 4);
  assert.equal(batch.runs[0].promptTokens, 100);
  const persisted = await api.client.query('SELECT input_price,output_price,cost_usd FROM experiment_runs WHERE id=$1', [batch.runs[0].id]);
  assert.equal(Number(persisted.rows[0].input_price), 2);
  assert.equal(Number(persisted.rows[0].output_price), 4);
  const priceUpdate = await request(`/experiment-platform/models/${model.data.id}`, 'PATCH', { displayName: 'Test updated', inputUsdPerMillion: 8, outputUsdPerMillion: 9, active: true });
  assert.equal(priceUpdate.status, 200);
  const priorPrice = await api.client.query('SELECT input_price,output_price FROM experiment_runs WHERE id=$1', [batch.runs[0].id]);
  assert.equal(Number(priorPrice.rows[0].input_price), 2);
  assert.equal(Number(priorPrice.rows[0].output_price), 4);
  const prompt = await request('/experiment-platform/prompts', 'POST', { name: '审阅提示', content: '版本一' });
  assert.equal(prompt.status, 201);
  const nextVersion = await request(`/experiment-platform/prompts/${prompt.data.id}/versions`, 'POST', { content: '版本二' });
  assert.equal(nextVersion.data.version, 2);
  const library = await request('/experiment-platform/prompts');
  assert.deepEqual(library.data.items.filter(item => item.id === prompt.data.id).map(item => item.version), [2, 1]);
});
