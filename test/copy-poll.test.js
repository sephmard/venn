import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IF_NEEDED, YES, buildSlots, utcToZoned, zonedToUtc } from '../public/core.js';
import { freshPoll, groupMail, pollDates, shiftPoll } from '../public/copy-poll.js';

const H = 3_600_000;
const NY = 'America/New_York';
const at = (date, minutes, tz = NY) => zonedToUtc(date, minutes, tz);
/** Option polls as [date, minutes] pairs in their own time zone, for easy reading. */
const wall = (ev) => ev.options.map((o) => [utcToZoned(o.start, ev.timezone).date, utcToZoned(o.start, ev.timezone).minutes]);
const options = (tz, ...days) => ({
  mode: 'options',
  timezone: tz,
  options: days.map(([d, m, len = 120]) => ({ start: at(d, m, tz), end: at(d, m, tz) + len * 60_000 })),
});

test('moved on a week, options keep their wall-clock time across the end of daylight saving', () => {
  // Tue Oct 27 2026, 7pm in New York (EDT); a week later it's EST, an hour later in UTC.
  const ev = options(NY, ['2026-10-27', 1140], ['2026-10-29', 1140, 90]);
  const next = shiftPoll(ev, () => 7);
  assert.deepEqual(wall(next), [
    ['2026-11-03', 1140],
    ['2026-11-05', 1140],
  ]);
  assert.equal(next.options[0].start - ev.options[0].start, 7 * 24 * H + H);
  assert.equal(next.options[1].end - next.options[1].start, 90 * 60_000); // lengths are kept
});

test('a week on keeps the local time through DST in both hemispheres', () => {
  // Sydney's clocks go forward on Oct 4 2026: Sunday at 10am stays 10am.
  const syd = 'Australia/Sydney';
  const au = shiftPoll(options(syd, ['2026-09-27', 600]), () => 7);
  assert.deepEqual(wall(au), [['2026-10-04', 600]]);
  assert.equal(au.options[0].start, Date.UTC(2026, 9, 3, 23)); // 10am AEDT
  // London's clocks go forward on Mar 29 2026.
  const ldn = shiftPoll(options('Europe/London', ['2026-03-24', 540]), () => 7);
  assert.equal(ldn.options[0].start, Date.UTC(2026, 2, 31, 8)); // 9am BST
  // A day whose offset is null is dropped.
  assert.deepEqual(
    wall(shiftPoll(options(NY, ['2026-10-27', 1140], ['2026-10-28', 1140]), (d) => (d === '2026-10-27' ? null : 0))),
    [['2026-10-28', 1140]],
  );
});

test('"when are you available" polls move their days and painted hours; times of day stay as they were', () => {
  const ev = {
    timezone: NY,
    dates: ['2026-10-27', '2026-10-29'],
    windows: [
      { date: '2026-10-27', start: 1080, end: 1260 },
      { date: '2026-10-29', start: 600, end: 720 },
    ],
    startMinute: 600,
    endMinute: 1260,
    slotMinutes: 30,
    durationMinutes: 60,
  };
  const next = shiftPoll(ev, () => 14);
  assert.deepEqual(next.dates, ['2026-11-10', '2026-11-12']);
  assert.deepEqual(next.windows, [
    { date: '2026-11-10', start: 1080, end: 1260 },
    { date: '2026-11-12', start: 600, end: 720 },
  ]);
  assert.equal(buildSlots(next).length, buildSlots(ev).length);
  assert.deepEqual(pollDates(ev), ['2026-10-27', '2026-10-29']);
});

test("the organizer's own answer moves with the dates; other people's answers don't come along", () => {
  const ev = { ...options(NY, ['2026-10-27', 1140], ['2026-10-28', 1140]), hostId: 'h' };
  const [a, b] = ev.options.map((o) => o.start);
  ev.participants = [
    { id: 'h', name: 'Sam', availability: { [a]: YES, [b]: IF_NEEDED } },
    { id: 'g', name: 'Ana', availability: { [a]: YES } },
  ];
  const next = shiftPoll(ev, () => 7);
  const [na, nb] = next.options.map((o) => o.start);
  assert.deepEqual(next.participants[0].availability, { [na]: YES, [nb]: IF_NEEDED });
  assert.deepEqual(next.participants[1], ev.participants[1]);
  assert.equal(next.slots, undefined);
  assert.equal(next.finalStart, undefined);

  // Free polls: the host's slots (here whole days) follow their days.
  const days = {
    timezone: NY,
    hostId: 'h',
    dates: ['2026-10-27'],
    slotMinutes: 1440,
    startMinute: 0,
    endMinute: 1440,
    durationMinutes: 1440,
  };
  days.participants = [{ id: 'h', availability: { [at('2026-10-27', 0)]: IF_NEEDED } }];
  assert.deepEqual(shiftPoll(days, () => 7).participants[0].availability, {
    [at('2026-11-03', 0)]: IF_NEEDED,
  });
});

test('a copied poll drops the dates that have passed, or moves on by whole weeks when none are left', () => {
  const now = Date.UTC(2026, 9, 26, 12); // Mon Oct 26 2026
  // All still to come: unchanged.
  const future = options(NY, ['2026-11-03', 1140]);
  assert.equal(freshPoll(future, now), future);
  // Some passed: they're dropped.
  assert.deepEqual(wall(freshPoll(options(NY, ['2026-10-20', 1140], ['2026-10-30', 1140]), now)), [['2026-10-30', 1140]]);
  // All passed: everything moves on by whole weeks, keeping weekdays and local times (over DST).
  const old = freshPoll(options(NY, ['2026-10-06', 1140], ['2026-10-08', 1140]), now);
  assert.deepEqual(wall(old), [
    ['2026-10-27', 1140],
    ['2026-10-29', 1140],
  ]);
  const older = freshPoll(options(NY, ['2026-09-01', 1140]), now);
  assert.deepEqual(wall(older), [['2026-10-27', 1140]]);
  assert.equal(utcToZoned(older.options[0].start, NY).weekday, 'Tue');
  // Days: the ones left are kept, unless a trip no longer has enough days in a row.
  const days = (dates, span = 1) => ({
    timezone: NY,
    dates,
    slotMinutes: 1440,
    startMinute: 0,
    endMinute: 1440,
    durationMinutes: span * 1440,
  });
  assert.deepEqual(freshPoll(days(['2026-10-24', '2026-10-26', '2026-10-27']), now).dates, ['2026-10-26', '2026-10-27']);
  assert.deepEqual(freshPoll(days(['2026-10-24', '2026-10-25', '2026-10-26'], 3), now).dates, [
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
  ]);
  // Hours polls keep today.
  const hours = { timezone: NY, dates: ['2026-10-26'], windows: [{ date: '2026-10-26', start: 600, end: 720 }], slotMinutes: 30 };
  assert.equal(freshPoll(hours, now), hours);
});

test('the email to last time’s group', () => {
  assert.equal(groupMail([], 'Book club', 'https://venn.day/e/x'), '');
  const mail = groupMail(['a@x.com', 'b+c@y.com'], 'Book club & wine', 'https://venn.day/e/x');
  assert.match(mail, /^mailto:\?bcc=a%40x\.com,b%2Bc%40y\.com&subject=Book%20club%20%26%20wine&body=/);
  assert.match(decodeURIComponent(mail.split('body=')[1]), /https:\/\/venn\.day\/e\/x/);
});

test('moved on by whole weeks, options stay the same distance apart, even when the first try lands earlier today', () => {
  // Two Tuesdays a week apart at 6pm UTC, long gone; copied on a Tuesday at 6:20pm, so the first
  // try puts the first one 20 minutes ago and it takes one more week.
  const UTC = 'UTC';
  const ev = options(UTC, ['2025-01-07', 1080, 60], ['2025-01-14', 1080, 60]);
  const next = freshPoll(ev, Date.UTC(2026, 9, 27, 18, 20));
  assert.deepEqual(wall(next), [
    ['2026-11-03', 1080],
    ['2026-11-10', 1080],
  ]);
});
