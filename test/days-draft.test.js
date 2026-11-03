// "Use AI" on /new: how the server settles the AI's answer into days, parts of the day or hours
// (src/days-draft.js), and how the page says what it picked (public/draft-summary.js). The cases
// follow the acceptance matrix in docs/AI.md ("How Use AI reads times"): each gives the answer a
// model following the rules would give, and some give the slips a model makes, which must still
// come out right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAYS_SCHEMA, DAYS_SYSTEM, daysPrompt, shapeDays } from '../src/days-draft.js';
import { zonedToUtc } from '../public/core.js';
import { draftDays } from '../src/ai.js';

globalThis.document ??= { getElementById: () => null };
const { describeDraft } = await import('../public/draft-summary.js');

const MON = '2026-11-02'; // Monday
const answer = (days, more = {}) => ({
  reading: '',
  title: 'Plan',
  emoji: '🍝',
  tile: 'dusk',
  location: '',
  timeOfDay: 'any',
  usualParts: [],
  firstDate: '',
  lastDate: '',
  daysInRow: 1,
  note: '',
  days: days
    .map((d) => (typeof d === 'string' ? { date: d } : d))
    .map((d) => ({ parts: [], from: '', to: '', ifNeeded: false, ...d })),
  ...more,
});
const shape = (out, today = MON, nowMinutes = 600) => shapeDays(out, { today, nowMinutes });
const pairs = (draft) => draft.days.map((d) => [d.date, d.part ?? (d.start != null ? `${d.start}-${d.end}` : 'all')]);

test('1: date night on the days they are free this week is evenings only, on exactly those days', () => {
  const draft = shape(
    answer(['2026-11-04', '2026-11-05', '2026-11-07', '2026-11-08'], {
      title: 'Date night',
      timeOfDay: 'parts',
      usualParts: ['evening'],
      lastDate: '2026-11-08',
    }),
  );
  assert.equal(draft.level, 'parts');
  assert.deepEqual(pairs(draft), [
    ['2026-11-04', 'evening'],
    ['2026-11-05', 'evening'],
    ['2026-11-07', 'evening'],
    ['2026-11-08', 'evening'],
  ]);
  const said = describeDraft(draft, 'Date night');
  assert.match(said.when, /^Evenings: /);
  for (const d of ['Nov 4', 'Nov 5', 'Nov 7', 'Nov 8']) assert.ok(said.when.includes(d), said.when);
});

test('1: the slips a model makes with date night still come out as evenings, never all day', () => {
  // It says "any" but gives the evening on each day.
  const perDay = shape(answer(['2026-11-04', '2026-11-05'].map((date) => ({ date, parts: ['evening'] }))));
  assert.equal(perDay.level, 'parts');
  assert.deepEqual(pairs(perDay), [
    ['2026-11-04', 'evening'],
    ['2026-11-05', 'evening'],
  ]);
  // It says "any" but names the usual part.
  const usual = shape(answer(['2026-11-07'], { usualParts: ['evening'] }));
  assert.deepEqual(pairs(usual), [['2026-11-07', 'evening']]);
  // Days past "this week" are dropped, whatever it listed.
  const span = shape(answer(['2026-11-08', '2026-11-09'], { usualParts: ['evening'], lastDate: '2026-11-08' }));
  assert.deepEqual(pairs(span), [['2026-11-08', 'evening']]);
});

test('1b: later in the week, a day that has passed is left out and said', () => {
  const draft = shape(
    answer(['2026-11-04', '2026-11-05', '2026-11-07', '2026-11-08'], { usualParts: ['evening'] }),
    '2026-11-05',
  );
  assert.deepEqual(
    draft.days.map((d) => d.date),
    ['2026-11-05', '2026-11-07', '2026-11-08'],
  );
  assert.match(draft.note, /Wednesday has already passed/);
});

test('2-4: stated parts of the day, and a stated part beating the one the plan implies', () => {
  const brunch = shape(answer(['2026-11-07', '2026-11-08'], { timeOfDay: 'parts', usualParts: ['morning'] }));
  assert.deepEqual(new Set(brunch.days.map((d) => d.part)), new Set(['morning']));
  // "Date night, but we're only available in the afternoon": what the model gives, kept as is.
  const afternoon = shape(answer(['2026-11-06', '2026-11-07'], { timeOfDay: 'parts', usualParts: ['afternoon'] }));
  assert.deepEqual(pairs(afternoon), [
    ['2026-11-06', 'afternoon'],
    ['2026-11-07', 'afternoon'],
  ]);
});

test('5-7: clock times stay as given, open ends run to midnight, and no length is made up', () => {
  const sync = shape(
    answer(
      ['2026-11-03', '2026-11-05'].map((date) => ({ date, from: '14:00', to: '16:00' })),
      { timeOfDay: 'clock' },
    ),
  );
  assert.equal(sync.level, 'hours');
  assert.deepEqual(pairs(sync), [
    ['2026-11-03', '840-960'],
    ['2026-11-05', '840-960'],
  ]);
  // 6:45–8:10 keeps all of it on the half-hour grid: 6:30–8:30.
  const odd = shape(answer([{ date: '2026-11-04', from: '18:45', to: '20:10' }], { timeOfDay: 'clock' }));
  assert.deepEqual(pairs(odd), [['2026-11-04', '1110-1230']]);
  const after6 = shape(answer([{ date: '2026-11-04', from: '18:00', to: '24:00' }], { timeOfDay: 'clock' }));
  assert.deepEqual(pairs(after6), [['2026-11-04', '1080-1440']]);
  assert.match(describeDraft(after6).when, /midnight/);
  const meeting = shape(answer([{ date: '2026-11-04', from: '09:00', to: '12:00' }], { timeOfDay: 'clock' }));
  assert.deepEqual(pairs(meeting), [['2026-11-04', '540-720']]);
  // "clock" with no times at all: whole days, and it says so rather than inventing hours.
  const none = shape(answer(['2026-11-04'], { timeOfDay: 'clock' }));
  assert.equal(none.level, 'days');
  assert.match(none.note, /No times were given/);
  // "parts" with no parts on any day (a slip: date night, but usualParts empty): whole days, said.
  const noParts = shape(answer(['2026-11-04', '2026-11-05'], { timeOfDay: 'parts', note: 'Took date night as evenings.' }));
  assert.equal(noParts.level, 'days');
  // The model's "Took date night as evenings." would contradict whole days, so it goes.
  assert.equal(noParts.note, "No time of day given, so it's whole days.");
  // With the person's words, the parts they imply: "date night" is evenings, said once.
  const slip = answer(['2026-11-04', '2026-11-05'], { timeOfDay: 'parts', note: 'Took date night as evenings.' });
  const evenings = shapeDays(slip, { today: MON, text: 'Date night Wed or Thu' });
  assert.equal(evenings.level, 'parts');
  assert.deepEqual(
    evenings.days.map((d) => `${d.date} ${d.part}`),
    ['2026-11-04 evening', '2026-11-05 evening'],
  );
  assert.equal(evenings.note, 'Took date night as evenings.');
  // Parts the words say beat what the plan implies: "date night, only afternoons".
  const said = shapeDays(slip, { today: MON, text: 'Date night, only afternoons, Wed or Thu' });
  assert.deepEqual([...new Set(said.days.map((d) => d.part))], ['afternoon']);
  // A trip of days in a row is whole days on purpose, so nothing is said.
  const trip = shape(answer(['2026-11-06', '2026-11-07'], { timeOfDay: 'parts', daysInRow: 2 }));
  assert.doesNotMatch(trip.note, /part of the day/);
});

test('8-9: all-day plans are whole days, and a trip is days in a row', () => {
  const beach = shape(answer(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']));
  assert.equal(beach.level, 'days');
  assert.equal(beach.row, 1);
  assert.equal(beach.days.length, 4);
  const trip = shape(answer(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'], { daysInRow: 3 }));
  assert.equal(trip.level, 'days');
  assert.equal(trip.row, 3);
  assert.match(describeDraft(trip).when, /^3 days in a row/);
  // A trip's length can't be silly.
  assert.equal(shape(answer(['2026-11-06'], { daysInRow: 400 })).row, 14);
  // A trip is whole days even if a part of the day slipped in.
  assert.equal(shape(answer([{ date: '2026-11-06', parts: ['evening'] }], { daysInRow: 2 })).level, 'days');
});

test('10-12: different windows on different days each keep their own, at the least precise mode that holds them', () => {
  const fs = shape(
    answer(
      [
        { date: '2026-11-06', parts: ['evening'] },
        { date: '2026-11-07', parts: ['afternoon'] },
      ],
      { timeOfDay: 'parts' },
    ),
  );
  assert.deepEqual(pairs(fs), [
    ['2026-11-06', 'evening'],
    ['2026-11-07', 'afternoon'],
  ]);
  const said = describeDraft(fs);
  assert.match(said.when, /Evenings: Fri, Nov 6; Afternoons: Sat, Nov 7/);
  // "Saturday any time or Sunday evening": Saturday all three parts.
  const any = shape(
    answer(
      [
        { date: '2026-11-07', parts: ['morning', 'afternoon', 'evening'] },
        { date: '2026-11-08', parts: ['evening'] },
      ],
      { timeOfDay: 'parts' },
    ),
  );
  assert.equal(any.days.filter((d) => d.date === '2026-11-07').length, 3);
  assert.match(describeDraft(any).when, /^Any time: Sat, Nov 7; Evenings: Sun, Nov 8$/);
  // A day with no window of its own, beside one with parts, is any time, not dropped.
  const loose = shape(answer([{ date: '2026-11-07' }, { date: '2026-11-08', parts: ['evening'] }]));
  assert.equal(loose.days.filter((d) => d.date === '2026-11-07').length, 3);
  // "Monday 7–9pm or Wednesday evening": hours, Wednesday at the evening's hours.
  const mixed = shape(
    answer(
      [
        { date: '2026-11-09', from: '19:00', to: '21:00' },
        { date: '2026-11-04', parts: ['evening'] },
      ],
      { timeOfDay: 'clock' },
    ),
  );
  assert.equal(mixed.level, 'hours');
  assert.deepEqual(pairs(mixed), [
    ['2026-11-04', '1080-1320'],
    ['2026-11-09', '1140-1260'],
  ]);
});

test('13-15: exclusions stay out, preferences are if needed, and repeated entries merge', () => {
  const pref = shape(
    answer(
      ['2026-11-09', '2026-11-10', '2026-11-14', '2026-11-15'].map((date) => ({
        date,
        ifNeeded: date < '2026-11-14',
      })),
      { usualParts: ['evening'] },
    ),
  );
  assert.deepEqual(
    pref.days.filter((d) => d.ifNeeded).map((d) => d.date),
    ['2026-11-09', '2026-11-10'],
  );
  assert.match(describeDraft(pref).when, /Nov 9 \(if needed\)/);
  // The same day twice, once available: available, with both windows.
  const twice = shape(
    answer([
      { date: '2026-11-07', parts: ['morning'], ifNeeded: true },
      { date: '2026-11-07', parts: ['evening'] },
    ]),
  );
  assert.deepEqual(twice.days, [
    { date: '2026-11-07', part: 'morning' },
    { date: '2026-11-07', part: 'evening' },
  ]);
});

test('16-18: weeks run Monday to Sunday, and months and years turn over', () => {
  const sunday = daysPrompt('coffee this week', { today: '2026-11-01', timezone: 'UTC', nowMinutes: 480 });
  assert.match(sunday, /^This week:\n {2}Sunday 2026-11-01\nNext week:\n {2}Monday 2026-11-02$/m);
  const friday = daysPrompt('dinner next week', { today: '2026-11-27', timezone: 'UTC', nowMinutes: 0 });
  assert.match(friday, /Next week:\n {2}Monday 2026-11-30\n {2}Tuesday 2026-12-01/);
  const dec = daysPrompt('first Saturday of next year', { today: '2026-12-29', timezone: 'UTC', nowMinutes: 0 });
  assert.match(dec, / {2}Saturday 2027-01-02$/m);
  assert.match(dec, /^Today is Tuesday 2026-12-29, 00:00 now\./m);
  // A model's date past the span or not a real date never gets through.
  const odd = shape(answer(['2026-02-30', '2026-11-0x', '2025-11-04', '2026-11-04']));
  assert.deepEqual(
    odd.days.map((d) => d.date),
    ['2026-11-04'],
  );
});

test('19-20: today is the person’s own, and today’s windows that are over are left out', async () => {
  // 03:00 UTC on Nov 3 is still 7 pm on Nov 2 in Los Angeles, and already noon on Nov 3 in Tokyo.
  const now = Date.UTC(2026, 10, 3, 3);
  const sent = [];
  const anthropic = {
    beta: {
      messages: {
        create: async (params) => {
          sent.push(params.messages[0].content);
          const today = /Today is \w+ (\S+),/.exec(params.messages[0].content)[1];
          const out = answer([today], { usualParts: ['evening'] });
          return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(out) }] };
        },
      },
    },
  };
  const la = await draftDays({}, { prompt: 'tonight', timezone: 'America/Los_Angeles' }, { now, anthropic });
  const tokyo = await draftDays({}, { prompt: 'tonight', timezone: 'Asia/Tokyo' }, { now, anthropic });
  assert.match(sent[0], /^Today is Monday 2026-11-02, 19:00 now\./m);
  assert.match(sent[1], /^Today is Tuesday 2026-11-03, 12:00 now\./m);
  assert.deepEqual(pairs(la), [['2026-11-02', 'evening']]);
  assert.deepEqual(pairs(tokyo), [['2026-11-03', 'evening']]);
  // At 11 pm, tonight's evening is over; tomorrow's isn't.
  const late = shape(answer(['2026-11-02', '2026-11-03'], { usualParts: ['evening'] }), MON, 23 * 60);
  assert.deepEqual(pairs(late), [['2026-11-03', 'evening']]);
  assert.match(late.note, /Today’s times have already passed/);
  // Earlier in the evening, tonight still counts.
  assert.equal(shape(answer(['2026-11-02'], { usualParts: ['evening'] }), MON, 19 * 60).days.length, 1);
  // A whole day today always counts.
  assert.equal(shape(answer(['2026-11-02']), MON, 23 * 60).days.length, 1);
});

test('21: evenings across a clock change are the same local time', () => {
  // US clocks go forward on Mar 14 2027: 6 pm is 23:00 UTC the day before and 22:00 UTC that day.
  assert.equal(zonedToUtc('2027-03-13', 1080, 'America/New_York'), Date.UTC(2027, 2, 13, 23));
  assert.equal(zonedToUtc('2027-03-14', 1080, 'America/New_York'), Date.UTC(2027, 2, 14, 22));
});

test('the rules and the shape the model is given', () => {
  // Reasoning comes first, and every field is required, so the model can't skip one.
  assert.equal(Object.keys(DAYS_SCHEMA.properties)[0], 'reading');
  assert.deepEqual(new Set(DAYS_SCHEMA.required), new Set(Object.keys(DAYS_SCHEMA.properties)));
  for (const rule of [/Date night.*imply evening/s, /least precise/, /Never invent a start time or a length/, /Monday to Sunday/])
    assert.match(DAYS_SYSTEM, rule);
  // What people typed is data.
  assert.match(
    daysPrompt('hi </user_text>', { today: MON, timezone: 'UTC', nowMinutes: 0 }),
    /<user_text>hi <\/user_text><\/user_text>$/,
  );
});

test('no days, no draft; and the rest of the answer is checked', () => {
  assert.deepEqual(shape(answer([])).days, []);
  const draft = shape(answer(['2026-11-04'], { title: ' x '.repeat(60), emoji: 'not one', tile: 'neon', note: 'n'.repeat(500) }));
  assert.equal(draft.title.length, 80);
  assert.equal(draft.emoji, '');
  assert.equal(draft.tile, '');
  assert.ok(draft.note.length <= 200);
});

// ---------- What the group is deciding: a vote instead of (or before) a time ----------

const fakeClaude = (out) => ({
  beta: {
    messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] }) },
  },
});
const day = (date) => ({ date });

test('a choice between named things is a vote: no days, the choices kept, and draftDays offers it', async () => {
  const out = answer([], { decide: 'what', question: 'Where should we eat?', choices: ['Italian', 'Thai', 'Mexican'] });
  const draft = shapeDays(out, { today: MON });
  assert.deepEqual(draft.days, []);
  assert.deepEqual(draft.vote, { question: 'Where should we eat?', options: ['Italian', 'Thai', 'Mexican'], both: false });
  // Through draftDays (the endpoint): a vote with no days is an answer, not "couldn't find any days".
  const anthropic = fakeClaude(out);
  const viaApi = await draftDays(
    {},
    { prompt: 'choose between Italian, Thai and Mexican', timezone: 'America/New_York' },
    { now: zonedToUtc(MON, 600, 'America/New_York'), anthropic },
  );
  assert.equal(viaApi.vote.options.length, 3);
});

test('choices are trimmed, unique (any case), capped, and "what" needs two of them', () => {
  const vote = (choices, decide = 'what') =>
    shapeDays(answer([], { decide, question: ' Which book? ', choices }), { today: MON }).vote;
  assert.deepEqual(vote([' Dune ', 'dune', 'Piranesi', '', 'x'.repeat(200)]).options, ['Dune', 'Piranesi', 'x'.repeat(120)]);
  assert.equal(vote(Array.from({ length: 30 }, (_, i) => `Book ${i}`)).options.length, 20);
  assert.equal(shapeDays(answer([], { decide: 'what', question: '', choices: ['Dune'] }), { today: MON }).vote, undefined); // one choice, no question: not a vote
  assert.deepEqual(vote(['Dune']).options, ['Dune']); // with a question it is
  assert.equal(vote(['Dune'], 'both').options.length, 1); // "both" still offers the vote, to finish there
  assert.equal(vote(['Dune', 'Piranesi']).question, 'Which book?');
});

test('"where and when": the days fill as usual, and the vote rides along', () => {
  const out = answer([day('2026-11-04'), day('2026-11-05')], {
    timeOfDay: 'parts',
    usualParts: ['evening'],
    decide: 'both',
    question: 'Where should we have dinner?',
    choices: [],
  });
  const draft = shapeDays(out, { today: MON });
  assert.equal(draft.level, 'parts');
  assert.equal(draft.days.length, 2);
  assert.deepEqual(draft.vote, { question: 'Where should we have dinner?', options: [], both: true });
});

test('"vote on our next book": a question with no choices named yet is still a vote', async () => {
  const out = answer([], { decide: 'what', question: 'What should we read next?', choices: [] });
  assert.deepEqual(shapeDays(out, { today: MON }).vote, { question: 'What should we read next?', options: [], both: false });
  const now = zonedToUtc(MON, 600, 'America/New_York');
  const viaApi = await draftDays(
    {},
    { prompt: 'Vote on our next book.', timezone: 'America/New_York' },
    { now, anthropic: fakeClaude(out) },
  );
  assert.equal(viaApi.vote.question, 'What should we read next?');
});

test('a plan with only a time to find, or an older answer with no decide, has no vote', () => {
  assert.equal(shapeDays(answer([day('2026-11-04')], { decide: 'when', choices: ['a', 'b'] }), { today: MON }).vote, undefined);
  assert.equal(shapeDays(answer([day('2026-11-04')]), { today: MON }).vote, undefined);
  assert.deepEqual(shapeDays(answer([], { decide: 'when' }), { today: MON }), { days: [] });
});

test('"both" with no days left is still "couldn’t find any days", not a silent vote', async () => {
  const out = answer([], { decide: 'both', question: 'Where?', choices: [] });
  const anthropic = fakeClaude(out);
  await assert.rejects(
    draftDays(
      {},
      { prompt: 'where and when', timezone: 'America/New_York' },
      { now: zonedToUtc(MON, 600, 'America/New_York'), anthropic },
    ),
    /Couldn't find any days/,
  );
});

test('the schema asks for decide, question and choices, and the rules give the vote examples', () => {
  for (const k of ['decide', 'question', 'choices']) assert.ok(DAYS_SCHEMA.required.includes(k), k);
  assert.match(DAYS_SYSTEM, /Italian, Thai and Mexican/);
  assert.match(DAYS_SYSTEM, /where and when/);
});
