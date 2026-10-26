import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IF_NEEDED, YES, buildSlots, utcToZoned, zonedToUtc } from '../public/core.js';
import {
  REPEATS,
  cycleDays,
  freshPoll,
  groupMail,
  nextCycle,
  nextLabel,
  nthWeekday,
  pollDates,
  shiftPoll,
  weekdayOrdinal,
} from '../public/repeat.js';

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

test('which of its weekday a date is: 1st to 4th, or the last (any date in the final week)', () => {
  assert.equal(weekdayOrdinal('2026-10-01'), 1);
  assert.equal(weekdayOrdinal('2026-10-13'), 2); // 2nd Tuesday
  assert.equal(weekdayOrdinal('2026-10-21'), 3);
  assert.equal(weekdayOrdinal('2026-10-24'), 4); // the 4th Saturday, with a 5th to come on the 31st
  assert.equal(weekdayOrdinal('2026-10-30'), 'last'); // the 5th Friday
  assert.equal(weekdayOrdinal('2026-11-27'), 'last'); // the 4th Friday, and the last in November
  assert.equal(weekdayOrdinal('2027-02-22'), 'last'); // a 28-day February
  assert.equal(weekdayOrdinal('2028-02-29'), 'last'); // leap day
});

test('the nth weekday of a month, with a 5th that does not exist falling back to the last', () => {
  assert.equal(nthWeekday(2026, 11, 2, 2), '2026-11-10'); // 2nd Tuesday
  assert.equal(nthWeekday(2026, 11, 0, 1), '2026-11-01'); // the 1st is a Sunday
  assert.equal(nthWeekday(2026, 11, 5, 'last'), '2026-11-27');
  assert.equal(nthWeekday(2026, 10, 5, 'last'), '2026-10-30');
  assert.equal(nthWeekday(2027, 2, 1, 5), '2027-02-22'); // no 5th Monday in February 2027
  assert.equal(nthWeekday(2026, 12, 4, 5), '2026-12-31'); // there is a 5th Thursday
  assert.equal(nthWeekday(2028, 2, 2, 'last'), '2028-02-29');
});

test('one cycle on: 7 or 14 days, or the same weekday of next month', () => {
  assert.equal(cycleDays('2026-10-13', 'weekly'), 7);
  assert.equal(cycleDays('2026-10-13', 'biweekly'), 14);
  assert.equal(cycleDays('2026-10-13', 'weekly', 3), 21);
  // 2nd Tuesday → 2nd Tuesday.
  assert.equal(cycleDays('2026-10-13', 'monthly'), 28); // Nov 10
  assert.equal(cycleDays('2026-11-10', 'monthly'), 28); // Dec 8
  // Over the year's end: 2nd Tuesday of December → 2nd Tuesday of January.
  assert.equal(cycleDays('2026-12-08', 'monthly'), 35); // 2027-01-12
  // The last Friday stays the last, whether it's a 4th or a 5th.
  assert.equal(cycleDays('2026-10-30', 'monthly'), 28); // Nov 27
  assert.equal(cycleDays('2026-11-27', 'monthly'), 28); // Dec 25
  assert.equal(cycleDays('2026-12-25', 'monthly'), 35); // 2027-01-29
  // A 5th Thursday becomes the last one.
  assert.equal(cycleDays('2026-10-29', 'monthly'), 28); // Nov 26
  // Month ends: the last Sunday of January → the last of February.
  assert.equal(cycleDays('2027-01-31', 'monthly'), 28); // Feb 28
  // Several months on at once, from the original date.
  assert.equal(cycleDays('2026-10-13', 'monthly', 3), 91); // 2027-01-12
  assert.equal(cycleDays('2026-01-13', 'monthly', 12), 364); // 2027-01-12, the 2nd Tuesday
  assert.throws(() => cycleDays('2026-10-13', 'yearly'), /Unknown repeat/);
  assert.deepEqual(REPEATS, ['weekly', 'biweekly', 'monthly']);
});

test('weekly options keep their wall-clock time across the end of daylight saving', () => {
  // Tue Oct 27 2026, 7pm in New York (EDT); a week later it's EST, an hour later in UTC.
  const ev = options(NY, ['2026-10-27', 1140], ['2026-10-29', 1140, 90]);
  const next = shiftPoll(ev, (d) => cycleDays(d, 'weekly'));
  assert.deepEqual(wall(next), [
    ['2026-11-03', 1140],
    ['2026-11-05', 1140],
  ]);
  assert.equal(next.options[0].start - ev.options[0].start, 7 * 24 * H + H);
  assert.equal(next.options[1].end - next.options[1].start, 90 * 60_000); // lengths are kept
});

test('monthly options: same weekday of the month, same local time, through DST in both hemispheres', () => {
  const ny = nextCycle(options(NY, ['2026-10-13', 1140]), 'monthly', Date.UTC(2026, 9, 20));
  assert.deepEqual(wall(ny), [['2026-11-10', 1140]]);
  assert.equal(ny.options[0].start, Date.UTC(2026, 10, 11, 0)); // 7pm EST
  // Sydney's clocks go forward on Oct 4 2026: the 1st Sunday at 10am stays 10am.
  const syd = 'Australia/Sydney';
  const au = nextCycle(options(syd, ['2026-09-06', 600]), 'monthly', Date.UTC(2026, 8, 7));
  assert.deepEqual(wall(au), [['2026-10-04', 600]]);
  assert.equal(au.options[0].start, Date.UTC(2026, 9, 3, 23)); // 10am AEDT
  // London's clocks go forward on Mar 29 2026.
  const ldn = nextCycle(options('Europe/London', ['2026-03-24', 540]), 'weekly', Date.UTC(2026, 2, 25));
  assert.equal(ldn.options[0].start, Date.UTC(2026, 2, 31, 8)); // 9am BST
});

test('days in a row move together, so a weekend stays a weekend over the end of a month', () => {
  // Fri Oct 30 – Sun Nov 1: the Friday is the last of October, so all three move to Nov 27–29.
  const trip = { timezone: NY, dates: ['2026-10-30', '2026-10-31', '2026-11-01'], slotMinutes: 1440, durationMinutes: 4320 };
  assert.deepEqual(nextCycle(trip, 'monthly', Date.UTC(2026, 9, 1)).dates, ['2026-11-27', '2026-11-28', '2026-11-29']);
  // Options on days next to each other keep their order too.
  const ev = options(NY, ['2026-10-26', 1140], ['2026-10-27', 1140], ['2026-10-30', 1140]);
  assert.deepEqual(
    wall(nextCycle(ev, 'monthly', Date.UTC(2026, 9, 1))).map(([d]) => d),
    ['2026-11-30', '2026-12-01', '2026-11-27'],
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
  const next = nextCycle(ev, 'biweekly', Date.UTC(2026, 9, 20));
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
  const next = nextCycle(ev, 'weekly', Date.UTC(2026, 9, 20));
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
  assert.deepEqual(nextCycle(days, 'weekly', Date.UTC(2026, 9, 20)).participants[0].availability, {
    [at('2026-11-03', 0)]: IF_NEEDED,
  });
});

test('planned late, the next one still lands in the future: as many cycles on as it takes', () => {
  // A book club on the 2nd Tuesday of August, planned again in late October: November's.
  const now = Date.UTC(2026, 9, 26, 12);
  assert.deepEqual(wall(nextCycle(options(NY, ['2026-08-11', 1140]), 'monthly', now)), [['2026-11-10', 1140]]);
  // A weekly run on Mondays at 7am, months ago: next Monday (Nov 2 2026).
  assert.deepEqual(wall(nextCycle(options(NY, ['2026-06-01', 420]), 'weekly', now)), [['2026-11-02', 420]]);
  // Every 2 weeks keeps the fortnight: from Jun 8, Nov 9 (not Nov 2).
  assert.deepEqual(wall(nextCycle(options(NY, ['2026-06-08', 420]), 'biweekly', now)), [['2026-11-09', 420]]);
  // Today, later on, counts as still to come; earlier today doesn't.
  assert.deepEqual(wall(nextCycle(options(NY, ['2026-10-19', 1140]), 'weekly', now)), [['2026-10-26', 1140]]);
  assert.deepEqual(wall(nextCycle(options(NY, ['2026-10-19', 420]), 'weekly', now)), [['2026-11-02', 420]]);
  // Never the same date: at least one cycle on, even for a poll still to come.
  assert.deepEqual(wall(nextCycle(options(NY, ['2026-12-01', 1140]), 'weekly', now)), [['2026-12-08', 1140]]);
  assert.throws(() => nextCycle(options(NY, ['2026-12-01', 1140]), 'daily', now), /Unknown repeat/);
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

test('what the next one is called, and the email to last time’s group', () => {
  assert.equal(nextLabel('monthly'), 'next month’s');
  assert.equal(nextLabel('weekly'), 'next week’s');
  assert.equal(nextLabel('biweekly'), 'the next');
  assert.equal(nextLabel('nope'), 'the next');
  assert.equal(groupMail([], 'Book club', 'https://venn.day/e/x'), '');
  const mail = groupMail(['a@x.com', 'b+c@y.com'], 'Book club & wine', 'https://venn.day/e/x');
  assert.match(mail, /^mailto:\?bcc=a%40x\.com,b%2Bc%40y\.com&subject=Book%20club%20%26%20wine&body=/);
  assert.match(decodeURIComponent(mail.split('body=')[1]), /https:\/\/venn\.day\/e\/x/);
});
