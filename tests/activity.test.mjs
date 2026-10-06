import test from 'node:test';
import assert from 'node:assert/strict';
import { listActivity } from '../mock/activity.mjs';
const users = [{ id: 'a', name: '甲', username: 'alice' }, { id: 'b', name: '乙', username: 'bob' }];
const entries = Array.from({ length: 21 }, (_, i) => ({ id: String(i).padStart(2, '0'), at: `2026-10-05T00:${String(i).padStart(2, '0')}:00Z`, type: i % 2 ? 'note' : 'create', ...(i < 18 ? { userId: i % 2 ? 'a' : 'b' } : {}) }));
test('combined activity, user and Shanghai date filters, including unknown historical actors', () => {
  const page = listActivity(entries, users, { type: 'note', userId: 'a', start: '2026-10-05', end: '2026-10-05' });
  assert.equal(page.total, 9);
  assert.ok(page.items.every(a => a.type === 'note' && a.userId === 'a'));
  assert.equal(listActivity(entries, users, { userId: '__unknown__' }).total, 3);
  assert.equal(listActivity(entries, users, { start: '2026-10-06' }).total, 0);
  assert.ok(page.users.some(u => u.id === '__unknown__'));
  assert.equal(listActivity([{ id: 'x', at: '2026-10-04T16:01:00Z', type: 'create' }], [], { start: '2026-10-05' }).total, 1);
});
test('cursor pages remain stable with inserted activities and tied timestamps', () => {
  const tied = entries.map(a => ({ ...a, at: '2026-10-05T00:00:00Z' }));
  let page = listActivity(tied, users);
  const collected = [...page.items];
  tied.push({ id: '99', at: '2026-10-06T00:00:00Z', type: 'create' });
  while (page.nextCursor) {
    page = listActivity(tied, users, { cursor: page.nextCursor });
    collected.push(...page.items);
  }
  assert.equal(collected.length, 21);
  assert.equal(new Set(collected.map(a => a.id)).size, 21);
  assert.equal(collected.at(-1).id, '00');
  assert.equal(page.nextCursor, null);
});
test('empty results and invalid filters/cursors are handled', () => {
  assert.deepEqual(listActivity([], [], {}).items, []);
  assert.throws(() => listActivity(entries, users, { type: 'bad' }), /活动类型/);
  assert.throws(() => listActivity(entries, users, { cursor: 'bad' }), /游标/);
});
