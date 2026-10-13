import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, http } from '../src/api/client.ts';

function browserGlobals(t, fetchImpl) {
  const oldWindow = globalThis.window;
  const oldStorage = globalThis.localStorage;
  const oldFetch = globalThis.fetch;
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.fetch = fetchImpl;
  t.after(() => {
    globalThis.window = oldWindow;
    globalThis.localStorage = oldStorage;
    globalThis.fetch = oldFetch;
  });
}

test('GET retries a transient network failure and exposes a cancellable countdown', async t => {
  let calls = 0;
  browserGlobals(t, async () => {
    calls++;
    if (calls === 1) throw new TypeError('network down');
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const states = [];
  window.addEventListener('admin:api-network-retry-state', event => {
    states.push(event.detail);
    if (event.detail.pending) window.dispatchEvent(new Event('admin:api-network-retry-now'));
  });
  assert.deepEqual(await http.get('/test'), { ok: true });
  assert.equal(calls, 2);
  assert.ok(states.some(state => state.pending === 1 && state.retryAt > Date.now() - 1000));
  assert.equal(states.at(-1).pending, 0);
});

test('POST network failure is not replayed because the server may have committed it', async t => {
  let calls = 0;
  browserGlobals(t, async () => { calls++; throw new TypeError('connection closed'); });
  await assert.rejects(http.post('/test', { title: 'once' }), error => error instanceof ApiError && error.status === 0 && /API/.test(error.message));
  assert.equal(calls, 1);
});

test('GET gives up after two retries and clears retry state', async t => {
  let calls = 0;
  browserGlobals(t, async () => { calls++; throw new TypeError('offline'); });
  const states = [];
  window.addEventListener('admin:api-network-retry-state', event => {
    states.push(event.detail);
    if (event.detail.pending) window.dispatchEvent(new Event('admin:api-network-retry-now'));
  });
  await assert.rejects(http.get('/test'), error => error instanceof ApiError && error.status === 0);
  assert.equal(calls, 3);
  assert.equal(states.at(-1).pending, 0);
});

test('HTTP errors are returned immediately without network retries', async t => {
  let calls = 0;
  browserGlobals(t, async () => { calls++; return new Response(JSON.stringify({ error: '服务暂不可用' }), { status: 503 }); });
  await assert.rejects(http.get('/test'), error => error instanceof ApiError && error.status === 503 && error.message === '服务暂不可用');
  assert.equal(calls, 1);
});
