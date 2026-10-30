import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, googleCalendarUrl } from '../public/calendar-export.js';
import { inviteText } from '../public/invite.js';
import {
  YES,
  IF_NEEDED,
  availabilityFromBusy,
  buildSlots,
  dayRuns,
  eventWindows,
  hostAnswer,
  keySlot,
  meetingEnd,
  overlapEnd,
  parseIcsBusy,
  rankTimes,
  utcToZoned,
  zonedToUtc,
} from '../public/core.js';
import { cycleGroup, groupState } from '../public/day-parts.js';
import { normalizeAvailability, normalizeEventInput } from '../src/validate.js';

const base = {
  title: 'Sync',
  timezone: 'America/New_York',
  dates: ['2026-11-02', '2026-11-03'],
  startMinute: 540,
  endMinute: 600,
  slotMinutes: 30,
  durationMinutes: 60,
};

test('zonedToUtc / utcToZoned round-trip, including DST', () => {
  assert.equal(zonedToUtc('2026-07-01', 540, 'America/New_York'), Date.UTC(2026, 6, 1, 13));
  assert.equal(zonedToUtc('2026-12-01', 540, 'America/New_York'), Date.UTC(2026, 11, 1, 14));
  assert.equal(zonedToUtc('2026-12-01', 540, 'Asia/Kolkata'), Date.UTC(2026, 11, 1, 3, 30));
  assert.deepEqual(utcToZoned(Date.UTC(2026, 11, 1, 3, 30), 'Asia/Kolkata'), {
    date: '2026-12-01',
    minutes: 540,
    weekday: 'Tue',
  });
});

test('buildSlots skips non-existent spring-forward times', () => {
  const slots = buildSlots({ ...base, dates: ['2026-03-08'], startMinute: 60, endMinute: 240, slotMinutes: 60 });
  // 2:00 doesn't exist in New York on 2026-03-08, so 1:00, 3:00 only.
  assert.deepEqual(
    slots.map((s) => utcToZoned(s, 'America/New_York').minutes),
    [60, 180],
  );
});

test('normalizeEventInput validates', () => {
  const ev = normalizeEventInput({ ...base, dates: ['2026-11-03', '2026-11-02', '2026-11-02'] });
  assert.deepEqual(ev.dates, ['2026-11-02', '2026-11-03']);
  assert.throws(() => normalizeEventInput({ ...base, title: ' ' }), /Title/);
  assert.throws(() => normalizeEventInput({ ...base, timezone: 'Mars/Base' }), /time zone/);
  assert.throws(() => normalizeEventInput({ ...base, dates: ['2026-02-30'] }), /Invalid date/);
  assert.throws(() => normalizeEventInput({ ...base, durationMinutes: 45 }), /multiple/);
  assert.throws(() => normalizeEventInput({ ...base, durationMinutes: 120 }), /longer/);
  assert.throws(() => normalizeEventInput({ ...base, endMinute: 540 }), /end time/);
});

test('normalizeAvailability drops unknown slots and rejects bad values', () => {
  const slots = buildSlots(base);
  const av = normalizeAvailability({ [slots[0]]: YES, [slots[1]]: IF_NEEDED, 123: YES, [slots[2]]: 0 }, slots);
  assert.deepEqual(av, { [slots[0]]: YES, [slots[1]]: IF_NEEDED });
  assert.throws(() => normalizeAvailability({ [slots[0]]: 7 }, slots));
});

test('rankTimes requires the whole meeting window and prefers yes over if-needed', () => {
  const slots = buildSlots(base); // 4 slots: 9:00, 9:30 on two days
  const [a, b, c, d] = slots;
  const people = [
    { name: 'Ann', availability: { [a]: YES, [b]: YES, [c]: YES, [d]: YES } },
    { name: 'Bob', availability: { [a]: YES, [c]: YES, [d]: IF_NEEDED } },
    { name: 'Cy', availability: { [c]: YES, [d]: YES } },
  ];
  const best = rankTimes(base, slots, people);
  // Only full-hour windows: 9:00 day 1 and 9:00 day 2 (9:30 has no second half-hour).
  assert.equal(best.length, 2);
  assert.equal(best[0].start, c);
  assert.deepEqual(best[0].yes, ['Ann', 'Cy']);
  assert.deepEqual(best[0].ifNeeded, ['Bob']);
  assert.deepEqual(best[1].yes, ['Ann']);
  assert.deepEqual(best[1].no, ['Bob', 'Cy']);
});

test('parseIcsBusy handles UTC, TZID, weekly recurrence, EXDATE and free/cancelled events', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:one',
    'DTSTART:20261102T143000Z',
    'DTEND:20261102T150000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:weekly',
    'DTSTART;TZID=America/New_York:20261026T090000',
    'DURATION:PT30M',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU;COUNT=6',
    'EXDATE;TZID=America/New_York:20261103T090000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:free',
    'DTSTART:20261103T150000Z',
    'DTEND:20261103T160000Z',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:allday',
    'DTSTART;VALUE=DATE:20261102',
    'DTEND;VALUE=DATE:20261103',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const slots = buildSlots(base);
  const busy = parseIcsBusy(ics, slots[0], slots.at(-1) + 30 * 60_000, 'UTC');
  // Nov 2 9:00 ET (weekly), Nov 2 9:30 ET (one-off). Nov 3 is excluded via EXDATE.
  assert.deepEqual(
    busy.map((b) => b.start),
    [zonedToUtc('2026-11-02', 540, 'America/New_York'), Date.UTC(2026, 10, 2, 14, 30)],
  );
  const av = availabilityFromBusy(
    slots.map((s) => ({ start: s, end: s + 30 * 60_000 })),
    busy,
  );
  assert.deepEqual(Object.keys(av).map(Number), slots.slice(2));
});

test('parseIcsBusy honours RECURRENCE-ID overrides and UNTIL', () => {
  const ics = [
    'BEGIN:VEVENT',
    'UID:daily',
    'DTSTART:20261102T140000Z',
    'DTEND:20261102T143000Z',
    'RRULE:FREQ=DAILY;UNTIL=20261104T000000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:daily',
    'RECURRENCE-ID:20261103T140000Z',
    'DTSTART:20261103T180000Z',
    'DTEND:20261103T183000Z',
    'END:VEVENT',
  ].join('\n');
  const busy = parseIcsBusy(ics, Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 10));
  assert.deepEqual(
    busy.map((b) => new Date(b.start).toISOString()),
    ['2026-11-02T14:00:00.000Z', '2026-11-03T18:00:00.000Z'],
  );
});

test('buildIcs escapes text', () => {
  const ics = buildIcs({ id: 'x', title: 'A, B; C', description: 'line1\nline2', start: 0, end: 3_600_000 });
  assert.match(ics, /SUMMARY:A\\, B\\; C/);
  assert.match(ics, /DESCRIPTION:line1\\nline2/);
  assert.match(ics, /DTSTART:19700101T000000Z/);
});

test('buildIcs invites attendees, with names that cannot break out of their quotes', () => {
  const ics = buildIcs({
    id: 'x',
    title: 'Dinner',
    start: 0,
    end: 3_600_000,
    attendees: [
      { name: 'Ana', email: 'ana@example.com' },
      { name: 'Sam "the man"\r\nX-EVIL:1', email: 'sam@example.com' },
    ],
  });
  const lines = ics.split('\r\n');
  assert.ok(lines.includes('ATTENDEE;CN="Ana";ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:ana@example.com'));
  assert.ok(lines.includes('ATTENDEE;CN="Sam the manX-EVIL:1";ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:sam@example.com'));
  assert.ok(!lines.some((l) => l.startsWith('X-EVIL')));
  assert.doesNotMatch(buildIcs({ id: 'x', title: 'Dinner', start: 0, end: 1 }), /ATTENDEE/);
});

test('googleCalendarUrl adds guests, for Google Calendar to invite', () => {
  const u = new URL(googleCalendarUrl({ title: 'Dinner', start: 0, end: 1, guests: ['ana@example.com', 'sam@example.com'] }));
  assert.equal(u.searchParams.get('add'), 'ana@example.com,sam@example.com');
  assert.equal(new URL(googleCalendarUrl({ title: 'Dinner', start: 0, end: 1 })).searchParams.get('add'), null);
});

const H = 3_600_000;
const t0 = Date.UTC(2026, 10, 3, 14);
const optionsPoll = {
  title: 'Lunch',
  timezone: 'UTC',
  mode: 'options',
  options: [
    { start: t0 + 24 * H, end: t0 + 25 * H },
    { start: t0, end: t0 + H },
    { start: t0 + 3 * H, end: t0 + 3.5 * H },
  ],
};

test('specific-times polls are validated and sorted', () => {
  const ev = normalizeEventInput(optionsPoll);
  assert.equal(ev.mode, 'options');
  assert.deepEqual(
    ev.options.map((o) => o.start),
    [t0, t0 + 3 * H, t0 + 24 * H],
  );
  assert.deepEqual(buildSlots(ev), [t0, t0 + 3 * H, t0 + 24 * H]);
  assert.equal(meetingEnd(ev, t0 + 3 * H), t0 + 3.5 * H);
  assert.throws(() => normalizeEventInput({ ...optionsPoll, options: [] }), /at least one/);
  assert.throws(() => normalizeEventInput({ ...optionsPoll, options: [{ start: t0, end: t0 }] }), /last between/);
  assert.throws(
    () =>
      normalizeEventInput({
        ...optionsPoll,
        options: [
          { start: t0, end: t0 + H },
          { start: t0, end: t0 + 2 * H },
        ],
      }),
    /same moment/,
  );
  assert.throws(() => normalizeEventInput({ ...optionsPoll, options: [{ start: 'x', end: 1 }] }), /Invalid/);
});

test('specific-times polls rank each option on its own', () => {
  const ev = normalizeEventInput(optionsPoll);
  const [a, b, c] = buildSlots(ev);
  const people = [
    { name: 'Ann', availability: { [a]: YES, [c]: YES } },
    { name: 'Bob', availability: { [a]: IF_NEEDED, [c]: YES } },
    { name: 'Cy', availability: { [b]: YES } },
  ];
  const best = rankTimes(ev, buildSlots(ev), people);
  assert.deepEqual(
    best.map((r) => r.start),
    [c, a, b],
  );
  assert.equal(best[0].end, c + H);
  assert.deepEqual(best[1].ifNeeded, ['Bob']);
});

test('calendar import checks each proposed time against busy events', () => {
  const ev = normalizeEventInput(optionsPoll);
  const busy = [{ start: t0 + 3.25 * H, end: t0 + 4 * H }];
  assert.deepEqual(Object.keys(availabilityFromBusy(eventWindows(ev), busy)).map(Number), [t0, t0 + 24 * H]);
});

test('tentative clashes become "if needed"', () => {
  const windows = [
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 20, end: 30 },
  ];
  const busy = [
    { start: 12, end: 15, tentative: true },
    { start: 25, end: 26 },
    { start: 28, end: 40, tentative: true },
  ];
  assert.deepEqual(availabilityFromBusy(windows, busy), { 0: YES, 10: IF_NEEDED });
});

// ---------- answering parts of the day ----------

test('"All day" and each part cycle all their times together: yes, if needed, cleared', () => {
  const slots = [1, 2, 3];
  assert.equal(groupState({}, slots), 0);
  assert.equal(groupState({ 1: YES }, slots), 'some');
  assert.equal(groupState({ 1: YES, 2: IF_NEEDED, 3: YES }, slots), 'some'); // a mix isn't "if needed"
  const a = { 1: YES, 9: IF_NEEDED };
  assert.deepEqual(cycleGroup(a, slots), { 1: YES, 2: YES, 3: YES, 9: IF_NEEDED });
  assert.equal(groupState(a, slots), YES);
  assert.deepEqual(cycleGroup(a, slots), { 1: IF_NEEDED, 2: IF_NEEDED, 3: IF_NEEDED, 9: IF_NEEDED });
  assert.deepEqual(cycleGroup(a, slots), { 9: IF_NEEDED }); // other days are left alone
  assert.deepEqual(cycleGroup({ 1: YES, 2: IF_NEEDED }, slots), { 1: YES, 2: YES, 3: YES });
});

test('days in a row: runs of dates, in order, across months and years', () => {
  assert.deepEqual(dayRuns([]), []);
  assert.deepEqual(dayRuns(['2026-11-08', '2026-11-06', '2026-11-07', '2026-11-11', '2026-11-07']), [
    ['2026-11-06', '2026-11-07', '2026-11-08'],
    ['2026-11-11'],
  ]);
  assert.deepEqual(dayRuns(['2026-12-31', '2027-01-01', '2026-11-30', '2026-12-01']), [
    ['2026-11-30', '2026-12-01'],
    ['2026-12-31', '2027-01-01'],
  ]);
});

test("the organizer's answer for a free poll: each pick's slot, yes or if needed, across DST", () => {
  const tz = 'America/New_York';
  // Whole days start at midnight, times at their minute, in the poll's time zone.
  assert.equal(keySlot('2026-11-06', tz), Date.UTC(2026, 10, 6, 5));
  assert.equal(keySlot('2026-11-06|1080', tz), Date.UTC(2026, 10, 6, 23));
  // 2:30 AM doesn't exist on the night the clocks go forward: no slot, like buildSlots.
  assert.equal(keySlot('2026-03-08|150', tz), null);

  const days = ['2026-10-31', '2026-11-01', '2026-11-02'];
  assert.deepEqual(hostAnswer(days, new Set(['2026-11-01']), tz), {
    [Date.UTC(2026, 9, 31, 4)]: YES,
    [Date.UTC(2026, 10, 1, 4)]: IF_NEEDED,
    [Date.UTC(2026, 10, 2, 5)]: YES, // after the clocks went back
  });
  // Every key is a slot of the poll the page creates, on the days the clocks change too.
  const ev = { timezone: tz, dates: days, startMinute: 0, endMinute: 1440, slotMinutes: 1440 };
  assert.deepEqual(Object.keys(hostAnswer(days, new Set(), tz)).map(Number), buildSlots(ev));
  for (const date of ['2026-03-08', '2026-11-01']) {
    const hours = [60, 90, 120, 150, 180].map((m) => `${date}|${m}`);
    const answer = hostAnswer(hours, new Set([`${date}|180`]), tz);
    const windows = [{ date, start: 60, end: 210 }];
    assert.deepEqual(Object.keys(answer).map(Number), buildSlots({ timezone: tz, windows, slotMinutes: 30 }));
    assert.equal(answer[keySlot(`${date}|180`, tz)], IF_NEEDED); // 3 AM
    assert.equal(Object.values(answer).filter((v) => v === IF_NEEDED).length, 1);
  }
});

test('inviteText: a short nudge to send with the link', () => {
  assert.equal(
    inviteText({ organizer: 'Sam', title: 'Dinner', emoji: '🍝' }),
    'Sam wants to find a time for Dinner 🍝. Tap your free days (no sign-up)',
  );
  assert.equal(inviteText({ title: 'Book club', pick: true }), 'When works for Book club? Tap the dates that work (no sign-up)');
  assert.equal(inviteText({ organizer: 'Sam', title: 'Dinner', set: true }), "It's set: Dinner! Add it to your calendar:");
});

test('any overlap (no length): back-to-back times with the same people are one time, picked whole', () => {
  // 6 to 10 PM in 30-minute slots; everyone free 7 to 8, Ben and Cai on to 9.
  const ev = {
    timezone: 'UTC',
    dates: ['2030-01-07'],
    windows: [{ date: '2030-01-07', start: 1080, end: 1320 }],
    slotMinutes: 30,
    durationMinutes: 30,
    anyLength: true,
  };
  const slots = buildSlots(ev);
  const at = (h, m = 0) => Date.UTC(2030, 0, 7, h, m);
  const free = (from, to) => Object.fromEntries(slots.filter((s) => s >= from && s < to).map((s) => [s, YES]));
  const people = [
    { name: 'Ana', availability: free(at(19), at(20)) },
    { name: 'Ben', availability: free(at(19), at(21)) },
    { name: 'Cai', availability: free(at(18), at(21)) },
  ];
  const [best, next] = rankTimes(ev, slots, people, 5);
  assert.deepEqual([best.start, best.end, best.yes], [at(19), at(20), ['Ana', 'Ben', 'Cai']]);
  assert.deepEqual([next.start, next.end, next.yes], [at(20), at(21), ['Ben', 'Cai']]);
  // Picked from its start, or from inside it, it runs to the end of the overlap.
  assert.equal(overlapEnd(ev, slots, people, at(19)), at(20));
  assert.equal(overlapEnd(ev, slots, people, at(19, 30)), at(20));
  assert.equal(meetingEnd({ ...ev, finalStart: at(19), finalEnd: at(20) }, at(19)), at(20));
  // With a length chosen, nothing merges: every 30 minutes is its own start.
  const fixed = { ...ev, anyLength: undefined };
  assert.equal(rankTimes(fixed, slots, people, 5)[0].end, at(19, 30));
  assert.equal(meetingEnd({ ...fixed, finalStart: at(19), finalEnd: at(20) }, at(19)), at(19, 30));
});
