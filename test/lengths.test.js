import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmail, lengthChip, zonedToUtc } from '../public/core.js';
import { optionsLength } from '../public/lengths.js';
import { TEMPLATES } from '../public/templates.js';
import { normalizeEmail } from '../src/notify.js';

const tz = 'America/New_York';
const H = 3_600_000;
const at = (date, minutes, hours) => {
  const start = zonedToUtc(date, minutes, tz);
  return { start, end: start + hours * H };
};
const days = (date, n) => ({ start: zonedToUtc(date, 0, tz), end: zonedToUtc(addDays(date, n), 0, tz) });
const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test('a poll’s options map onto the create page’s lengths', () => {
  // Minutes: 30 min and 1 hour have their own chips, anything else is "Other" with that length.
  assert.deepEqual(optionsLength([at('2026-11-05', 1140, 2), at('2026-11-06', 1140, 2)], tz), { length: 120 });
  assert.deepEqual(optionsLength([at('2026-11-05', 1140, 0.5)], tz), { length: 30 });
  assert.deepEqual(optionsLength([at('2026-11-05', 600, 1)], tz), { length: 60 });
  // Each a morning, an afternoon or an evening: half days, whatever their own lengths.
  assert.deepEqual(optionsLength([at('2026-11-05', 540, 3), at('2026-11-05', 720, 5), at('2026-11-06', 1080, 4)], tz), {
    length: 'half',
  });
  // Three hours that aren't a part of the day stay three hours.
  assert.deepEqual(optionsLength([at('2026-11-05', 1140, 3)], tz), { length: 180 });
  // One part of the day mixed with other times is a number of minutes.
  assert.deepEqual(optionsLength([at('2026-11-05', 540, 3), at('2026-11-06', 600, 3)], tz), { length: 180 });
  // Whole days, including across the end of daylight saving time (Nov 1 2026 in New York).
  assert.deepEqual(optionsLength([days('2026-10-31', 1), days('2026-11-01', 1)], tz), { length: 'allday', days: [1, 1] });
  // Several days, each its own length.
  assert.deepEqual(optionsLength([days('2026-10-30', 3), days('2026-11-06', 4)], tz), { length: 'days', days: [3, 4] });
  assert.deepEqual(optionsLength([], tz), { length: 120 });
});

test('length chips: every length a template uses has one; half days and other minutes are under Custom', () => {
  for (const m of [60, 120, 180, 240]) assert.equal(lengthChip(m), String(m));
  for (const l of ['allday', 'days']) assert.equal(lengthChip(l), l);
  for (const m of [15, 30, 45, 90, 300, 720, 'half']) assert.equal(lengthChip(m), 'custom');
  for (const t of TEMPLATES) assert.notEqual(lengthChip(t.length), 'custom', t.label);
});

test('the create page checks the organizer’s email with the server’s rule', () => {
  for (const ok of ['sam@example.com', 'Sam.Lee+polls@mail.example.co.uk']) assert.ok(isEmail(ok) && normalizeEmail(ok), ok);
  const long = `${'a'.repeat(250)}@b.co`;
  for (const bad of [
    'sam@example',
    'sam example.com',
    '@example.com',
    'sam@exa mple.com',
    'a,b@example.com',
    '"sam"@x.com',
    long,
  ]) {
    assert.equal(isEmail(bad), false, bad);
    assert.throws(() => normalizeEmail(bad), /Invalid email/);
  }
});
