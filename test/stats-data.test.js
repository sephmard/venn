import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, change, dayList, series, total, weekdays, weeks } from '../public/stats-data.js';

const counts = [
  { day: '2026-10-05', name: 'poll.created', props: { kind: 'pick' }, count: 2 },
  { day: '2026-10-05', name: 'poll.created', props: { kind: 'free' }, count: 1 },
  { day: '2026-10-07', name: 'poll.created', props: { kind: 'pick' }, count: 4 },
  { day: '2026-10-07', name: 'view', props: { page: 'poll', as: 'guest' }, count: 9 },
  { day: '2026-10-07', name: 'view', props: { page: 'pick' }, count: 5 },
  { day: '2026-09-30', name: 'poll.created', props: { kind: 'pick' }, count: 7 }, // before the period
];

test('stats page: a metric per day, with the days that had nothing', () => {
  const days = dayList('2026-10-05', 3);
  assert.deepEqual(days, ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.deepEqual(series(counts, METRICS.polls, days), [
    { day: '2026-10-05', n: 3 },
    { day: '2026-10-06', n: 0 },
    { day: '2026-10-07', n: 4 },
  ]);
  // Only poll pages count as poll views.
  assert.deepEqual(
    series(counts, METRICS.views, days).map((d) => d.n),
    [0, 0, 9],
  );
  assert.equal(total(counts, METRICS.polls), 14);
  // Across the end of a month and a clock change.
  assert.deepEqual(dayList('2026-10-30', 4), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('stats page: weeks and days of the week', () => {
  const daily = dayList('2026-10-05', 10).map((day, i) => ({ day, n: i + 1 })); // Monday the 5th
  assert.deepEqual(weeks(daily), [
    { day: '2026-10-05', end: '2026-10-11', n: 28 },
    { day: '2026-10-12', end: '2026-10-14', n: 27 }, // a short last week
  ]);
  const byDow = weekdays(daily);
  assert.deepEqual(
    byDow.map((d) => d.n),
    [1 + 8, 2 + 9, 3 + 10, 4, 5, 6, 7],
  );
  assert.equal(byDow[0].dow, 0); // Monday first
});

test('stats page: change on the period before', () => {
  assert.equal(change(15, 10), 50);
  assert.equal(change(5, 10), -50);
  assert.equal(change(10, 10), 0);
  assert.equal(change(3, 0), null); // nothing before to compare with
});
