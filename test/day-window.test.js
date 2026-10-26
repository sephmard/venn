import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayWindow } from '../public/day-window.js';

test('dayWindow: the day strip covers the months ahead, and always runs past the day shown', () => {
  const days = dayWindow('2026-10-26', '2026-10-26');
  assert.equal(days[0], '2026-10-26');
  assert.equal(days.at(-1), '2027-04-26'); // 182 days on
  assert.equal(days.length, 183);
  assert.ok(days.includes('2027-03-14') && days.includes('2027-03-15')); // one per day, across DST
  assert.equal(new Set(days).size, days.length);
  // A day far ahead (jumped to) gets eight more weeks after it.
  const far = dayWindow('2026-10-26', '2027-09-01');
  assert.equal(far[0], '2026-10-26');
  assert.equal(far.at(-1), '2027-10-27');
  // Shorter windows; a day in the past changes nothing.
  assert.deepEqual(dayWindow('2026-12-30', '2026-01-01', 3, 1), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(dayWindow('2028-02-28', '2028-02-28', 0, 2), ['2028-02-28', '2028-02-29', '2028-03-01']);
});
