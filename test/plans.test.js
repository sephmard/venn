// Polls for real-life plans: whole days, trips over several days, all-day options.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, googleCalendarUrl, outlookCalendarUrl } from '../public/calendar-export.js';
import {
  YES,
  IF_NEEDED,
  allDaySpan,
  buildSlots,
  eventWindows,
  isDaysPoll,
  longestRun,
  meetingEnd,
  rankTimes,
  zonedToUtc,
} from '../public/core.js';
import { normalizeEventInput } from '../src/validate.js';

const NY = 'America/New_York';
// US clocks go back on Sunday 2026-11-01, so that day is 25 hours long.
const days = (overrides = {}) =>
  normalizeEventInput({
    title: 'Cabin weekend',
    timezone: NY,
    dates: ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'],
    startMinute: 0,
    endMinute: 1440,
    slotMinutes: 1440,
    durationMinutes: 1440,
    ...overrides,
  });

test('whole-day polls: one slot per date, each ending at the next midnight even across DST', () => {
  const ev = days();
  assert.ok(isDaysPoll(ev));
  const slots = buildSlots(ev);
  assert.deepEqual(
    slots,
    ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'].map((d) => zonedToUtc(d, 0, NY)),
  );
  const sunday = eventWindows(ev)[2];
  assert.equal(sunday.end - sunday.start, 25 * 3600_000);
  assert.equal(sunday.end, zonedToUtc('2026-11-02', 0, NY));
});

test('trips: rank runs of consecutive days, across the DST change', () => {
  const ev = days({ durationMinutes: 3 * 1440 });
  const slots = buildSlots(ev);
  const [fri, sat, sun, mon] = slots;
  const people = [
    { name: 'Ana', availability: { [fri]: YES, [sat]: YES, [sun]: YES, [mon]: YES } },
    { name: 'Bo', availability: { [sat]: YES, [sun]: YES, [mon]: IF_NEEDED } },
  ];
  const best = rankTimes(ev, slots, people, 5);
  assert.equal(best.length, 2);
  assert.equal(best[0].start, sat); // Sat–Mon: Ana yes, Bo if needed
  assert.deepEqual(best[0].ifNeeded, ['Bo']);
  assert.equal(best[0].end, zonedToUtc('2026-11-03', 0, NY));
  assert.equal(meetingEnd(ev, sat), zonedToUtc('2026-11-03', 0, NY));
  assert.deepEqual(best[1].no, ['Bo']); // Fri–Sun: Bo can't do Friday
});

test('trips: a gap in the dates breaks the run', () => {
  const ev = days({ dates: ['2026-10-30', '2026-10-31', '2026-11-05'], durationMinutes: 2 * 1440 });
  const slots = buildSlots(ev);
  const all = { name: 'Ana', availability: Object.fromEntries(slots.map((s) => [s, YES])) };
  assert.deepEqual(
    rankTimes(ev, slots, [all], 5).map((b) => b.start),
    [slots[0]],
  );
});

test('whole-day polls: validation', () => {
  assert.throws(() => days({ startMinute: 60 }), /line up/);
  assert.throws(() => days({ durationMinutes: 15 * 1440 }), /at most 14 days/);
  assert.throws(() => days({ durationMinutes: 720 }), /multiple of the slot size/);
});

test('options can be all day or span several days', () => {
  const start = zonedToUtc('2026-11-06', 0, NY);
  const end = zonedToUtc('2026-11-09', 0, NY);
  const ev = normalizeEventInput({ title: 'Trip', timezone: NY, mode: 'options', options: [{ start, end }] });
  assert.equal(meetingEnd(ev, start), end);
  assert.throws(
    () =>
      normalizeEventInput({
        title: 'Too long',
        timezone: NY,
        mode: 'options',
        options: [{ start, end: zonedToUtc('2026-11-22', 0, NY) }],
      }),
    /14 days/,
  );
});

test('location and emoji are kept; anything that is not emoji is refused', () => {
  const ev = days({ location: '  Rosa’s, 12 Main St ', emoji: '🍝' });
  assert.equal(ev.location, 'Rosa’s, 12 Main St');
  assert.equal(ev.emoji, '🍝');
  assert.equal(days({ emoji: '🧑‍🤝‍🧑' }).emoji, '🧑‍🤝‍🧑');
  assert.equal('location' in days(), false);
  for (const bad of ['<b>', 'hi', '1', '🍝'.repeat(9), 5]) assert.throws(() => days({ emoji: bad }), /emoji/);
  assert.throws(() => days({ location: 'x'.repeat(201) }), /Location/);
});

test('all-day spans become all-day calendar events', () => {
  const start = zonedToUtc('2026-11-06', 0, NY);
  const end = zonedToUtc('2026-11-08', 0, NY);
  const allDay = allDaySpan(start, end, NY);
  assert.deepEqual(allDay, { startDate: '2026-11-06', endDate: '2026-11-08' });
  assert.equal(allDaySpan(start + 3600_000, end, NY), null);
  assert.equal(allDaySpan(start, start + 3600_000, NY), null);

  const info = { id: 'abc', title: 'Trip', start, end, allDay, location: 'Lake house, Maine' };
  const ics = buildIcs(info);
  assert.match(ics, /DTSTART;VALUE=DATE:20261106\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261108\r\n/);
  assert.match(ics, /LOCATION:Lake house\\, Maine\r\n/);
  assert.match(googleCalendarUrl(info), /dates=20261106%2F20261108/);
  assert.match(googleCalendarUrl(info), /location=Lake\+house/);
  const outlook = new URL(outlookCalendarUrl(info)).searchParams;
  assert.equal(outlook.get('allday'), 'true');
  assert.equal(outlook.get('startdt'), '2026-11-06');
});

test('parts of the day: options must be a morning, afternoon or evening', async () => {
  const { DAY_PARTS, isPartsPoll, partOf } = await import('../public/core.js');
  const part = (d, p) => ({ start: zonedToUtc(d, p.start, NY), end: zonedToUtc(d, p.end, NY) });
  const options = ['2026-11-06', '2026-11-07'].flatMap((d) => DAY_PARTS.map((p) => part(d, p)));
  const ev = normalizeEventInput({ title: 'Brunch or dinner', timezone: NY, mode: 'options', layout: 'parts', options });
  assert.ok(isPartsPoll(ev));
  assert.equal(ev.options.length, 6);
  assert.equal(partOf(options[2].start, options[2].end, NY).key, 'evening');
  assert.equal(partOf(options[0].start, options[0].end + 60_000, NY), null);

  const odd = { start: zonedToUtc('2026-11-06', 600, NY), end: zonedToUtc('2026-11-06', 660, NY) };
  assert.throws(
    () => normalizeEventInput({ title: 'x', timezone: NY, mode: 'options', layout: 'parts', options: [odd] }),
    /morning, an afternoon or an evening/,
  );
  assert.throws(
    () => normalizeEventInput({ title: 'x', timezone: NY, mode: 'options', layout: 'grid', options: [odd] }),
    /Unknown layout/,
  );
  assert.equal(isPartsPoll(normalizeEventInput({ title: 'x', timezone: NY, mode: 'options', options: [odd] })), false);
});

test('free-time polls can have different hours on different days', () => {
  const ev = normalizeEventInput({
    title: 'Dinner',
    timezone: NY,
    durationMinutes: 60,
    windows: [
      { date: '2026-11-07', start: 1080, end: 1200 }, // 6 – 8 PM
      { date: '2026-11-07', start: 1170, end: 1260 }, // overlaps: merges to 6 – 9 PM
      { date: '2026-11-08', start: 600, end: 690 }, // 10 – 11:30 AM
      { date: '2026-11-08', start: 900, end: 930 }, // 3 – 3:30 PM, shorter than the meeting
    ],
  });
  assert.deepEqual(ev.dates, ['2026-11-07', '2026-11-08']);
  assert.deepEqual(
    ev.windows.map((w) => [w.date, w.start, w.end]),
    [
      ['2026-11-07', 1080, 1260],
      ['2026-11-08', 600, 690],
      ['2026-11-08', 900, 930],
    ],
  );
  assert.equal(ev.slotMinutes, 30);
  const slots = buildSlots(ev);
  assert.equal(slots.length, 6 + 3 + 1);
  assert.equal(slots[0], zonedToUtc('2026-11-07', 1080, NY));

  // A meeting never runs across a gap between windows, or from one day into the next.
  const all = Object.fromEntries(slots.map((s) => [s, YES]));
  const best = rankTimes(ev, slots, [{ name: 'Ana', availability: all }], 50);
  assert.equal(best.length, 5 + 2);
  assert.ok(best.every((b) => b.end - b.start === 3_600_000));

  assert.throws(() => normalizeEventInput({ title: 'x', timezone: NY, windows: [] }), /at least one time/);
  assert.throws(
    () => normalizeEventInput({ title: 'x', timezone: NY, windows: [{ date: '2026-11-07', start: 600, end: 615 }] }),
    /line up/,
  );
  assert.throws(
    () =>
      normalizeEventInput({
        title: 'x',
        timezone: NY,
        durationMinutes: 120,
        windows: [{ date: '2026-11-07', start: 600, end: 660 }],
      }),
    /shorter than the meeting/,
  );
});

test('longestRun counts the most days in a row, across months and in any order', () => {
  assert.equal(longestRun([]), 0);
  assert.equal(longestRun(['2026-11-03', '2026-11-05']), 1); // Tue and Thu
  // Four weekends of Fri–Sun never make 4 days in a row.
  const weekends = [6, 13, 20, 27].flatMap((d) => [0, 1, 2].map((i) => `2026-11-${String(d + i).padStart(2, '0')}`));
  assert.equal(longestRun(weekends), 3);
  assert.equal(longestRun(['2026-12-01', '2026-11-30', '2026-11-29', '2026-11-29']), 3);
});
