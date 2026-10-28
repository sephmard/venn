import { test } from 'node:test';
import assert from 'node:assert/strict';

// ui.js looks up the page's elements when it loads; a stand-in document is enough for these helpers.
globalThis.document ??= { getElementById: () => null };
const { monthWeeks, stepDay, TAP_KEY, tripFrom, tripKey, tripRuns } = await import('../public/day-answer.js');

const run = (from, n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

test('monthWeeks: two weeks of days take only the weeks they fall in, Sunday first', () => {
  const m = monthWeeks(run('2026-11-03', 14)); // Tue Nov 3 to Mon Nov 16
  assert.equal(m.length, 1);
  assert.equal(m[0].month, '2026-11');
  assert.deepEqual(
    m[0].weeks.map((w) => [w[0], w[6]]),
    [
      ['2026-11-01', '2026-11-07'],
      ['2026-11-08', '2026-11-14'],
      ['2026-11-15', '2026-11-21'],
    ],
  );
});

test('monthWeeks: a poll across a month break carries on in the next month, with other months blank', () => {
  const m = monthWeeks(['2026-12-02', '2026-11-30', '2026-11-30', '2026-12-31', '2027-01-01']);
  assert.deepEqual(
    m.map((x) => x.month),
    ['2026-11', '2026-12', '2027-01'],
  );
  assert.deepEqual(m[0].weeks, [['2026-11-29', '2026-11-30', null, null, null, null, null]]);
  assert.deepEqual(m[1].weeks[0], [null, null, '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
  assert.equal(m[1].weeks.length, 2); // the week of the 2nd, and the week of the 31st; nothing between
  assert.deepEqual(m[2].weeks, [[null, null, null, null, null, '2027-01-01', '2027-01-02']]);
  assert.deepEqual(monthWeeks([]), []);
});

test('stepDay: arrows move between the poll days, a week up and down, Home and End to the ends', () => {
  const days = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-12', '2026-11-20'];
  assert.equal(stepDay(days, '2026-11-04', 'ArrowRight'), '2026-11-05');
  assert.equal(stepDay(days, '2026-11-04', 'ArrowLeft'), '2026-11-03');
  assert.equal(stepDay(days, '2026-11-03', 'ArrowLeft'), '2026-11-03'); // the edge
  assert.equal(stepDay(days, '2026-11-20', 'ArrowRight'), '2026-11-20');
  assert.equal(stepDay(days, '2026-11-05', 'ArrowDown'), '2026-11-12'); // a week on
  assert.equal(stepDay(days, '2026-11-04', 'ArrowDown'), '2026-11-12'); // the nearest day after a week
  assert.equal(stepDay(days, '2026-11-12', 'ArrowDown'), '2026-11-20');
  assert.equal(stepDay(days, '2026-11-20', 'ArrowDown'), '2026-11-20');
  assert.equal(stepDay(days, '2026-11-12', 'ArrowUp'), '2026-11-05');
  assert.equal(stepDay(days, '2026-11-20', 'ArrowUp'), '2026-11-12'); // the nearest day before a week
  assert.equal(stepDay(days, '2026-11-04', 'ArrowUp'), '2026-11-04');
  assert.equal(stepDay(days, '2026-11-12', 'Home'), '2026-11-03');
  assert.equal(stepDay(days, '2026-11-03', 'End'), '2026-11-20');
  assert.equal(stepDay(days, '2026-11-03', 'a'), null);
});

test('the tap key says how to answer, like the create page, and how to mark unavailable', () => {
  for (const text of ['Tap: available', 'Tap again: if needed', 'Tap again, or leave blank: unavailable'])
    assert.ok(TAP_KEY.includes(text));
});

test('trips: a tap marks the days in a row from it, or ending on it when the poll runs out', () => {
  const days = ['2030-01-04', '2030-01-05', '2030-01-06', '2030-01-07', '2030-01-10', '2030-01-11'];
  assert.deepEqual(tripFrom(days, '2030-01-04', 3), ['2030-01-04', '2030-01-05', '2030-01-06']);
  // Only two days left after the 6th: the three ending on the 7th.
  assert.deepEqual(tripFrom(days, '2030-01-07', 3), ['2030-01-05', '2030-01-06', '2030-01-07']);
  // A stretch shorter than the trip: all of it.
  assert.deepEqual(tripFrom(days, '2030-01-10', 3), ['2030-01-10', '2030-01-11']);
  assert.deepEqual(tripFrom(days, '2030-01-11', 3), ['2030-01-10', '2030-01-11']);
});

test('trips: the marked stretches long enough to go', () => {
  const marked = ['2030-01-04', '2030-01-05', '2030-01-06', '2030-01-10', '2030-01-11', '2030-01-30'];
  assert.deepEqual(tripRuns(marked, 3), [['2030-01-04', '2030-01-06']]);
  assert.deepEqual(tripRuns(marked, 2), [
    ['2030-01-04', '2030-01-06'],
    ['2030-01-10', '2030-01-11'],
  ]);
  assert.deepEqual(tripRuns([], 2), []);
  assert.match(tripKey(3), /Tap a day: 3 days from it/);
});
