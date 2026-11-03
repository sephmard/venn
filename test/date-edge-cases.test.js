// Dates and times at their edges: clock changes (US, EU, Sydney, and zones whose clocks jump at
// midnight), a guest in another time zone from the organizer (Tokyo, and half-hour Kolkata), month
// and year ends, leap days, trips across a month's end, hours either side of midnight, past days,
// and "today" for Use AI where UTC is already tomorrow. Each case checks that the slots, how they
// read, and the best time agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  YES,
  IF_NEEDED,
  addDays,
  allDaySpan,
  buildSlots,
  dayRuns,
  dayStart,
  keySlot,
  longestRun,
  meetingEnd,
  partOf,
  rankTimes,
  slotEnd,
  utcToZoned,
  zonedToUtc,
} from '../public/core.js';
import { normalizeEventInput } from '../src/validate.js';
import { daysPrompt, shapeDays } from '../src/days-draft.js';
import { draftDays } from '../src/ai.js';

globalThis.document ??= { getElementById: () => null };
const { fmtTimeRange, fmtWhen } = await import('../public/when.js');
const { overlapHtml } = await import('../public/overlap.js');

const H = 3_600_000;
const LA = 'America/Los_Angeles';
const iso = (t) => new Date(t).toISOString();
/** Labels with their narrow and no-break spaces as plain ones, so they read as written here. */
const plain = (s) => s.replace(/[\u00a0\u202f\u2009]/g, ' ');
/** A Venn's HTML as the text between its tags, with its day headings' <h3> tags kept to match on. */
const words = (html) =>
  plain(
    html
      .split(/(<\/?h3>)|<[^>]*>/)
      .filter(Boolean)
      .join(''),
  );
const wall = (t, tz) => {
  const z = utcToZoned(t, tz);
  return `${z.date} ${String(Math.floor(z.minutes / 60)).padStart(2, '0')}:${String(z.minutes % 60).padStart(2, '0')}`;
};
const hoursPoll = (timezone, dates, startMinute, endMinute, more = {}) => ({
  title: 'Sync',
  timezone,
  dates,
  startMinute,
  endMinute,
  slotMinutes: 30,
  durationMinutes: 60,
  ...more,
});
const daysPoll = (timezone, dates, days = 1) => ({
  title: 'Trip',
  timezone,
  dates,
  startMinute: 0,
  endMinute: 1440,
  slotMinutes: 1440,
  durationMinutes: days * 1440,
});
const everyone = (slots, names = ['Ana', 'Ben']) =>
  names.map((name) => ({ id: name, name, availability: Object.fromEntries(slots.map((s) => [s, YES])) }));

// ---------- clock changes ----------

test('US spring forward (LA, Mar 8 2026): 2:00 and 2:30 never exist, and an hour across the gap is a real hour', () => {
  const ev = hoursPoll(LA, ['2026-03-08'], 0, 240);
  const slots = buildSlots(ev);
  assert.deepEqual(
    slots.map((s) => wall(s, LA).slice(11)),
    ['00:00', '00:30', '01:00', '01:30', '03:00', '03:30'],
  );
  // Every slot is 30 real minutes after the one before: 1:30 PST is 09:30 UTC, 3:00 PDT is 10:00 UTC.
  for (let i = 1; i < slots.length; i++) assert.equal(slots[i] - slots[i - 1], H / 2);
  assert.equal(keySlot('2026-03-08|120', LA), null);
  assert.equal(keySlot('2026-03-08|150', LA), null);
  assert.equal(keySlot('2026-03-08|180', LA), Date.UTC(2026, 2, 8, 10));
  // A meeting from 1:30 runs an hour of real time, to 3:30 on the new clock, and says so.
  const ranked = rankTimes(ev, slots, everyone(slots), Infinity);
  const across = ranked.find((r) => r.start === Date.UTC(2026, 2, 8, 9, 30));
  assert.equal(across.end - across.start, H);
  assert.equal(plain(fmtTimeRange(across.start, across.end, LA)), '1:30 – 3:30 AM');
  assert.equal(across.end, meetingEnd(ev, across.start));
});

test('US clock changes for whole days: Mar 8 is 23 hours, Nov 1 is 25, and both read as one day', () => {
  for (const [date, hours] of [
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ]) {
    const ev = daysPoll(LA, [addDays(date, -1), date, addDays(date, 1)]);
    const slots = buildSlots(ev);
    assert.deepEqual(
      slots.map((s) => wall(s, LA)),
      ev.dates.map((d) => `${d} 00:00`),
    );
    const s = slots[1];
    assert.equal(slotEnd(ev, s) - s, hours * H);
    assert.deepEqual(allDaySpan(s, slotEnd(ev, s), LA), { startDate: date, endDate: addDays(date, 1) });
    assert.match(fmtWhen(s, slotEnd(ev, s), LA), /, all day$/);
  }
  // A two-day trip over the change: Sat Oct 31 to the end of Sun Nov 1, 49 hours.
  const trip = daysPoll(LA, ['2026-10-31', '2026-11-01'], 2);
  const slots = buildSlots(trip);
  const [best] = rankTimes(trip, slots, everyone(slots), 5);
  assert.equal(best.end - best.start, 49 * H);
  assert.equal(best.end, meetingEnd(trip, best.start));
  assert.equal(plain(fmtWhen(best.start, best.end, LA)), 'Sat, Oct 31 – Sun, Nov 1');
});

test('US fall back (LA, Nov 1 2026): the repeated hour is asked about once, on the first clock', () => {
  const ev = hoursPoll(LA, ['2026-11-01'], 0, 240);
  const slots = buildSlots(ev);
  assert.equal(new Set(slots).size, slots.length);
  assert.deepEqual(
    slots.map((s) => wall(s, LA).slice(11)),
    ['00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00', '03:30'],
  );
  // 1:00 and 1:30 are daylight time (08:00 and 08:30 UTC); 2:00 is standard time, 10:00 UTC.
  assert.equal(keySlot('2026-11-01|60', LA), Date.UTC(2026, 10, 1, 8));
  assert.equal(keySlot('2026-11-01|120', LA), Date.UTC(2026, 10, 1, 10));
  // Away from the repeated hour, every ranked hour is one real hour.
  for (const r of rankTimes(ev, slots, everyone(slots), Infinity).filter((r) => r.end <= Date.UTC(2026, 10, 1, 8)))
    assert.equal(r.end - r.start, H);
});

test('US fall back: an hour from 1:00 AM on Nov 1 reads as "1:00 – 2:00 AM", and so does the picked time', () => {
  const ev = hoursPoll(LA, ['2026-11-01'], 0, 240);
  const slots = buildSlots(ev);
  const ranked = rankTimes(ev, slots, everyone(slots), Infinity);
  const r = ranked.find((x) => x.start === Date.UTC(2026, 10, 1, 8));
  assert.equal(plain(fmtTimeRange(r.start, r.end, LA)), '1:00 – 2:00 AM');
  assert.equal(r.end, Date.UTC(2026, 10, 1, 10)); // two real hours: 1:00 comes round twice
  assert.equal(meetingEnd({ ...ev, finalStart: r.start }, r.start), r.end);
  // 1:30 to 2:30 is offered too, across the seam, and every label is one hour on the clock.
  const half = ranked.find((x) => x.start === Date.UTC(2026, 10, 1, 8, 30));
  assert.equal(plain(fmtTimeRange(half.start, half.end, LA)), '1:30 – 2:30 AM');
  for (const x of ranked) assert.equal(utcToZoned(x.end, LA).minutes - utcToZoned(x.start, LA).minutes, 60);
});

test('EU clock changes (Berlin, Mar 29 and Oct 25 2026): gaps skipped, the long day is 25 hours', () => {
  const tz = 'Europe/Berlin';
  const spring = buildSlots(hoursPoll(tz, ['2026-03-29'], 60, 240));
  assert.deepEqual(
    spring.map((s) => wall(s, tz).slice(11)),
    ['01:00', '01:30', '03:00', '03:30'],
  );
  const autumn = daysPoll(tz, ['2026-10-24', '2026-10-25', '2026-10-26']);
  const days = buildSlots(autumn);
  assert.deepEqual(
    days.map((s) => (slotEnd(autumn, s) - s) / H),
    [24, 25, 24],
  );
  // Between the EU and US changes (Oct 25 – Nov 1) Berlin is 8 hours ahead of LA, not 9.
  const morning = zonedToUtc('2026-10-28', 540, tz);
  assert.equal(wall(morning, LA), '2026-10-28 01:00');
  assert.equal(wall(zonedToUtc('2026-11-04', 540, tz), LA), '2026-11-04 00:00');
});

test('Southern hemisphere (Sydney): clocks go forward Oct 4 and back Apr 5 2026', () => {
  const tz = 'Australia/Sydney';
  assert.deepEqual(
    buildSlots(hoursPoll(tz, ['2026-10-04'], 60, 240)).map((s) => wall(s, tz).slice(11)),
    ['01:00', '01:30', '03:00', '03:30'],
  );
  const ev = daysPoll(tz, ['2026-04-04', '2026-04-05', '2026-04-06', '2026-10-03', '2026-10-04', '2026-10-05']);
  assert.deepEqual(
    buildSlots(ev).map((s) => (slotEnd(ev, s) - s) / H),
    [24, 25, 24, 24, 23, 24],
  );
  // A Sydney morning is the evening before in LA, an hour later once Sydney's summer starts.
  assert.equal(wall(zonedToUtc('2026-09-30', 540, tz), LA), '2026-09-29 16:00');
  assert.equal(wall(zonedToUtc('2026-10-07', 540, tz), LA), '2026-10-06 15:00');
});

test('zones whose clocks jump at midnight keep that day: Santiago, Havana, Cairo, Beirut', () => {
  for (const [tz, date] of [
    ['America/Santiago', '2026-09-06'],
    ['America/Havana', '2026-03-08'],
    ['Africa/Cairo', '2026-04-24'],
    ['Asia/Beirut', '2026-03-29'],
  ]) {
    const ev = daysPoll(tz, [addDays(date, -1), date, addDays(date, 1)]);
    const slots = buildSlots(ev);
    // Three days asked about, three days to answer, each on its own date and starting it.
    assert.deepEqual(
      slots.map((s) => utcToZoned(s, tz).date),
      ev.dates,
      tz,
    );
    assert.equal(keySlot(date, tz), slots[1], tz);
    assert.equal(dayStart(date, tz), slots[1], tz);
    // The day it starts at 1 AM is 23 hours; the day before still ends at its own midnight.
    assert.equal(wall(slots[1], tz), `${date} 01:00`, tz);
    assert.equal(slotEnd(ev, slots[0]), slots[1], tz);
    assert.equal(slotEnd(ev, slots[1]) - slots[1], 23 * H, tz);
    for (const s of slots) assert.ok(allDaySpan(s, slotEnd(ev, s), tz), `${tz} ${wall(s, tz)} is a whole day`);
    // A three-day trip covers all three.
    const trip = { ...ev, durationMinutes: 3 * 1440 };
    const [best] = rankTimes(trip, slots, everyone(slots), 5);
    assert.deepEqual(allDaySpan(best.start, best.end, tz), { startDate: ev.dates[0], endDate: addDays(date, 2) }, tz);
  }
  // Havana's clocks go back from 1 AM to midnight on Nov 1: that day starts at its first midnight, 25 hours.
  const havana = daysPoll('America/Havana', ['2026-10-31', '2026-11-01', '2026-11-02']);
  const slots = buildSlots(havana);
  assert.equal(slots[1], Date.UTC(2026, 10, 1, 4));
  assert.deepEqual(
    slots.map((s) => (slotEnd(havana, s) - s) / H),
    [24, 25, 24],
  );
});

// ---------- guests in another time zone ----------

test('organizer in LA, guest in Tokyo: the same instants, read on the guest’s own clock and date', () => {
  // Tue Nov 10, 5–10 PM in LA is Wed Nov 11, 10 AM – 3 PM in Tokyo.
  const ev = hoursPoll(LA, ['2026-11-10'], 1020, 1320, { durationMinutes: 120 });
  ev.slots = buildSlots(ev);
  const evening = ev.slots.filter((s) => utcToZoned(s, LA).minutes >= 1080 && utcToZoned(s, LA).minutes < 1260);
  const people = [
    { id: 'o', name: 'Organizer', availability: Object.fromEntries(ev.slots.map((s) => [s, YES])) },
    { id: 'g', name: 'Guest', availability: Object.fromEntries(evening.map((s) => [s, YES])) },
  ];
  const [best] = rankTimes(ev, ev.slots, people, 1);
  assert.equal(best.start, zonedToUtc('2026-11-10', 1080, LA));
  assert.equal(best.end - best.start, 2 * H);
  assert.equal(plain(fmtTimeRange(best.start, best.end, LA)), '6:00 – 8:00 PM');
  assert.equal(plain(fmtTimeRange(best.start, best.end, 'Asia/Tokyo')), '11:00 AM – 1:00 PM');
  // The guest's Venn: one card, Wed Nov 11, with the best stretch on Tokyo's clock.
  const html = plain(overlapHtml({ ev, people, tz: 'Asia/Tokyo', windows: [] }));
  assert.match(html, /<h3>Wed, Nov 11<\/h3>/);
  assert.doesNotMatch(html, /<h3>Tue, Nov 10<\/h3>/);
  assert.match(html, /Best: 11:00 AM – 2:00 PM, 2 of 2, everyone/);
  // The organizer's: the same stretch on LA's clock.
  assert.match(plain(overlapHtml({ ev, people, tz: LA, windows: [] })), /Tue, Nov 10: Best: 6:00 – 9:00 PM, 2 of 2/);
});

test('a parts-of-the-day poll from LA reads as times on the guest’s day in Tokyo, and as Evening in LA', () => {
  const start = zonedToUtc('2026-11-10', 1080, LA);
  const end = zonedToUtc('2026-11-10', 1320, LA);
  assert.equal(partOf(start, end, LA).key, 'evening');
  assert.equal(partOf(start, end, 'Asia/Tokyo'), null);
  const ev = { title: 'Dinner', timezone: LA, mode: 'options', layout: 'parts', options: [{ start, end }], durationMinutes: 240 };
  const people = everyone([start]);
  const ctx = { ev, people, windows: ev.options, parts: true, list: true, when: () => '' };
  assert.match(words(overlapHtml({ ...ctx, tz: LA })), /Tue, Nov 10<\/h3>.*Evening · 6 – 10 PM/s);
  assert.match(words(overlapHtml({ ...ctx, tz: 'Asia/Tokyo' })), /Wed, Nov 11<\/h3>.*11:00 AM – 3:00 PM/s);
});

test('a whole-day poll keeps its dates for a guest whose zone is a day ahead', () => {
  const ev = daysPoll(LA, ['2026-12-31', '2027-01-01']);
  const slots = buildSlots(ev);
  // Midnight in LA is already 5 PM in Tokyo: the slots are still the organizer's dates.
  assert.equal(utcToZoned(slots[0], 'Asia/Tokyo').date, '2026-12-31');
  assert.equal(utcToZoned(slots[0], 'Asia/Tokyo').minutes, 17 * 60);
  const people = everyone(slots);
  // The poll page reads whole days in the poll's zone (event.js), so the guest sees the same dates.
  const html = plain(
    overlapHtml({
      ev: { ...ev, slots },
      people,
      tz: LA,
      windows: slots.map((s) => ({ start: s, end: slotEnd(ev, s) })),
      days: true,
      list: true,
      when: (s, e) => fmtWhen(s, e, LA),
    }),
  );
  assert.match(html, /Thu, Dec 31, all day.*Fri, Jan 1, all day/s);
});

test('a guest in Kolkata (UTC+5:30) sees an LA hour at half past, and the best hour agrees', () => {
  const ev = hoursPoll(LA, ['2026-11-10'], 540, 720, { slotMinutes: 60, durationMinutes: 60 });
  ev.slots = buildSlots(ev);
  const people = everyone([ev.slots[0]]);
  const [best] = rankTimes(ev, ev.slots, people, 1);
  assert.equal(plain(fmtTimeRange(best.start, best.end, 'Asia/Kolkata')), '10:30 – 11:30 PM');
  const html = plain(overlapHtml({ ev, people, tz: 'Asia/Kolkata', windows: [] }));
  assert.match(html, /Tue, Nov 10: Best: 10:30 – 11:30 PM, 2 of 2/);
  // LA's 11 AM is already Wednesday in Kolkata, so it's a second card.
  assert.match(html, /<h3>Wed, Nov 11<\/h3>/);
  // The timeline under each card still has times on it, at half past.
  const axis = /class="ov-axis"[^>]*>(.*?)<\/div>/s.exec(html)[1];
  assert.match(axis, /<span>\d+:30 [AP]M<\/span>/);
});

// ---------- months, years and leap days ----------

test('Dec 31 → Jan 1, and Feb 28 → Feb 29 or Mar 1', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2100-02-28', 1), '2100-03-01'); // not a leap year
  const input = { title: 'x', timezone: LA, startMinute: 0, endMinute: 1440, slotMinutes: 1440 };
  assert.throws(() => normalizeEventInput({ ...input, dates: ['2026-02-29'] }), /Invalid date/);
  assert.deepEqual(normalizeEventInput({ ...input, dates: ['2028-02-29'] }).dates, ['2028-02-29']);
  assert.deepEqual(dayRuns(['2027-01-01', '2026-12-30', '2026-12-31', '2028-02-29', '2028-03-01']), [
    ['2026-12-30', '2026-12-31', '2027-01-01'],
    ['2028-02-29', '2028-03-01'],
  ]);
  assert.equal(longestRun(['2026-02-27', '2026-02-28', '2026-03-01']), 3);
  assert.equal(longestRun(['2028-02-27', '2028-02-28', '2028-03-01']), 2);
});

test('a three-day trip across New Year and across a month end ranks and reads as one run', () => {
  for (const [dates, label] of [
    [['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'], 'Wed, Dec 30, 2026 – Fri, Jan 1, 2027'],
    [['2028-02-28', '2028-02-29', '2028-03-01'], 'Mon, Feb 28 – Wed, Mar 1'],
    [['2026-01-30', '2026-01-31', '2026-02-01'], 'Fri, Jan 30 – Sun, Feb 1'],
  ]) {
    const ev = daysPoll('Europe/London', dates, 3);
    const slots = buildSlots(ev);
    const people = everyone(slots);
    // With four days, Ben only if needed on the last puts the first run ahead, everyone available.
    if (slots.length > 3) people[1].availability[slots.at(-1)] = IF_NEEDED;
    const [best] = rankTimes(ev, slots, people, 1);
    assert.equal(best.start, slots[0]);
    assert.equal(best.yes.length, 2);
    assert.equal(best.end, slotEnd(ev, slots[2]));
    assert.equal(best.end, meetingEnd(ev, best.start));
    assert.equal(plain(fmtWhen(best.start, best.end, ev.timezone)), label);
  }
  // A gap in the dates breaks the run: Dec 30 and Jan 1 aren't days in a row.
  const gap = daysPoll(LA, ['2026-12-30', '2027-01-01', '2027-01-02'], 2);
  const slots = buildSlots(gap);
  assert.deepEqual(
    rankTimes(gap, slots, everyone(slots), 5).map((r) => utcToZoned(r.start, LA).date),
    ['2027-01-01'],
  );
});

// ---------- around midnight ----------

test('an hours window can’t cross midnight, but late and early windows on two days join up', () => {
  const input = { title: 'x', timezone: LA, dates: ['2026-11-13'], slotMinutes: 30 };
  assert.throws(() => normalizeEventInput({ ...input, startMinute: 1320, endMinute: 120 }), /end time must be after/);
  assert.throws(
    () => normalizeEventInput({ ...input, windows: [{ date: '2026-11-13', start: 1320, end: 120 }] }),
    /end after it starts/,
  );
  const ev = normalizeEventInput({
    ...input,
    durationMinutes: 120,
    windows: [
      { date: '2026-12-31', start: 1320, end: 1440 },
      { date: '2027-01-01', start: 0, end: 120 },
    ],
  });
  const slots = buildSlots(ev);
  const ranked = rankTimes(ev, slots, everyone(slots), Infinity);
  // 10 PM – midnight, 10:30 PM – 12:30 AM, ..., midnight – 2 AM: five two-hour stretches.
  assert.equal(ranked.length, 5);
  const across = ranked.find((r) => r.start === zonedToUtc('2026-12-31', 1380, LA));
  assert.equal(plain(fmtTimeRange(across.start, across.end, LA)), 'Thu 11:00 PM – Fri 1:00 AM');
  // The same stretch for a guest in New York is all on New Year's Day.
  assert.equal(plain(fmtTimeRange(across.start, across.end, 'America/New_York')), '2:00 – 4:00 AM');
});

// ---------- past days and Use AI's "today" ----------

test('Use AI never keeps a day before today, and says which named day has passed', () => {
  const out = {
    title: 'Dinner',
    timeOfDay: 'any',
    usualParts: [],
    firstDate: '2026-12-28',
    lastDate: '2027-01-10',
    daysInRow: 1,
    note: '',
    days: ['2026-12-29', '2026-12-31', '2027-01-05'].map((date) => ({ date, parts: [], from: '', to: '', ifNeeded: false })),
  };
  const draft = shapeDays(out, { today: '2026-12-31', nowMinutes: 600 });
  assert.deepEqual(
    draft.days.map((d) => d.date),
    ['2026-12-31', '2027-01-05'],
  );
  assert.match(draft.note, /Tuesday has already passed/);
});

test('Use AI’s calendar on a Sunday night in LA, when UTC is already Monday', () => {
  // Sun Nov 1 2026, 9 PM in LA is Mon Nov 2, 05:00 UTC.
  const prompt = daysPrompt('this weekend', { today: '2026-11-01', timezone: LA, nowMinutes: 21 * 60 });
  assert.match(prompt, /^Today is Sunday 2026-11-01, 21:00 now\./m);
  // This week is only today; the coming weekend is under Next week, and the calendar starts today.
  assert.match(prompt, /^This week:\n {2}Sunday 2026-11-01\nNext week:\n {2}Monday 2026-11-02$/m);
  assert.match(prompt, / {2}Saturday 2026-11-07\n {2}Sunday 2026-11-08\nIn 2 weeks:/);
  assert.doesNotMatch(prompt, /2026-10-31/);
});

test('Use AI near New Year: "next Tuesday" is in 2027 for LA, and Auckland is already on Jan 1', async () => {
  // 20:00 UTC on Dec 31 2026 is noon on Dec 31 in LA and 9 AM on Jan 1 2027 in Auckland.
  const now = Date.UTC(2026, 11, 31, 20);
  const sent = [];
  const anthropic = {
    beta: {
      messages: {
        create: async (params) => {
          const content = params.messages[0].content;
          sent.push(content);
          // A model following the rules: next Tuesday is the Tuesday under "Next week", evenings.
          const tue = /Next week:(?:\n {2}\w+ \S+)*?\n {2}Tuesday (\S+)/.exec(content)[1];
          const out = {
            reading: '',
            title: 'Dinner',
            emoji: '🍝',
            tile: 'dusk',
            location: '',
            timeOfDay: 'parts',
            usualParts: ['evening'],
            firstDate: tue,
            lastDate: tue,
            daysInRow: 1,
            days: [{ date: tue, parts: [], from: '', to: '', ifNeeded: false }],
            note: '',
          };
          return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(out) }] };
        },
      },
    },
  };
  const la = await draftDays({}, { prompt: 'dinner next tuesday', timezone: LA }, { now, anthropic });
  const nz = await draftDays({}, { prompt: 'dinner next tuesday', timezone: 'Pacific/Auckland' }, { now, anthropic });
  assert.match(sent[0], /^Today is Thursday 2026-12-31, 12:00 now\./m);
  assert.match(sent[1], /^Today is Friday 2027-01-01, 09:00 now\./m);
  assert.deepEqual(la.days, [{ date: '2027-01-05', part: 'evening' }]);
  assert.deepEqual(nz.days, [{ date: '2027-01-05', part: 'evening' }]);
  // Kolkata, half an hour off the hour, still gets its own minutes.
  const kolkata = daysPrompt('x', { ...utcToZonedToday(now, 'Asia/Kolkata') });
  assert.match(kolkata, /^Today is Friday 2027-01-01, 01:30 now\./m);
});

function utcToZonedToday(now, timezone) {
  const { date, minutes } = utcToZoned(now, timezone);
  return { today: date, timezone, nowMinutes: minutes };
}

test('Use AI: a window "to 00:00" means until midnight, not an empty window', () => {
  const out = {
    title: 'Party',
    timeOfDay: 'clock',
    usualParts: [],
    firstDate: '',
    lastDate: '',
    daysInRow: 1,
    note: '',
    days: [{ date: '2026-11-07', parts: [], from: '20:00', to: '00:00', ifNeeded: false }],
  };
  assert.deepEqual(shapeDays(out, { today: '2026-11-02' }).days, [{ date: '2026-11-07', start: 1200, end: 1440 }]);
});

test.todo('Use AI: a window across midnight ("22:00" to "02:00") keeps the day, at least until midnight', () => {
  const out = {
    title: 'Party',
    timeOfDay: 'clock',
    usualParts: [],
    days: [{ date: '2026-11-07', parts: [], from: '22:00', to: '02:00', ifNeeded: false }],
  };
  assert.equal(shapeDays(out, { today: '2026-11-02' }).days.length, 1);
});

test('keySlot and slot instants agree for every half hour over a year of clock changes', () => {
  for (const tz of [LA, 'Europe/Berlin', 'Australia/Sydney', 'Asia/Kolkata', 'America/Santiago']) {
    for (const date of ['2026-03-08', '2026-03-29', '2026-04-05', '2026-09-06', '2026-10-04', '2026-10-25', '2026-11-01']) {
      const slots = buildSlots(hoursPoll(tz, [date], 0, 1440));
      for (const s of slots) {
        const z = utcToZoned(s, tz);
        assert.equal(z.date, date, `${tz} ${iso(s)}`);
        assert.equal(keySlot(`${date}|${z.minutes}`, tz), s, `${tz} ${date} ${z.minutes}`);
      }
      // A 23-hour day has 46 half hours, a 25-hour one 48 (the repeated hour once), others 48.
      assert.ok(slots.length === 46 || slots.length === 48, `${tz} ${date}: ${slots.length}`);
    }
  }
});
