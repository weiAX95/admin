import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextScheduleAt, validTimeZone } from '../mock/experiment-schedule-time.mjs';

test('IANA schedule handles Shanghai day/week/month and DST gaps/overlap', () => {
  assert.equal(validTimeZone('Asia/Shanghai'), true);
  assert.equal(validTimeZone('Not/AZone'), false);
  assert.equal(nextScheduleAt({frequency:'daily',localTime:'09:00',timeZone:'Asia/Shanghai'},Date.parse('2026-10-06T23:00:00Z')),'2026-10-07T01:00:00.000Z');
  assert.equal(nextScheduleAt({frequency:'weekly',localTime:'09:00',timeZone:'Asia/Shanghai',weekday:1},Date.parse('2026-10-06T00:00:00Z')),'2026-10-12T01:00:00.000Z');
  assert.equal(nextScheduleAt({frequency:'monthly',localTime:'09:00',timeZone:'Asia/Shanghai',dayOfMonth:31},Date.parse('2027-02-01T00:00:00Z')),'2027-02-28T01:00:00.000Z');
  assert.equal(nextScheduleAt({frequency:'daily',localTime:'02:30',timeZone:'America/New_York'},Date.parse('2026-03-08T00:00:00Z')),'2026-03-08T07:00:00.000Z');
  assert.equal(nextScheduleAt({frequency:'daily',localTime:'01:30',timeZone:'America/New_York'},Date.parse('2026-11-01T00:00:00Z')),'2026-11-01T05:30:00.000Z');
});
