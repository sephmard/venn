// Use AI and RSVPs: the day is set, who's coming? Jev picks the kind first (System 1), Claude's
// read fills in the RSVP (System 2), and the words decide when neither is sure (src/ask-kind.js).

import test from 'node:test';
import assert from 'node:assert/strict';

import { draftAny } from '../src/ai.js';
import { jevPick, pickKind, saidKind } from '../src/ask-kind.js';
import { rsvpOf } from '../src/days-draft.js';
import { cleanUsage } from '../src/usage.js';

const TODAY = '2030-01-07'; // a Monday
const NOW = Date.UTC(2030, 0, 7, 12);
const ENV = { JEV_API_KEY_OPENROUTER: 'test-key' };

const day = (date, over = {}) => ({ date, parts: [], from: '', to: '', ifNeeded: false, ...over });
const read = (over = {}) => ({
  reading: 'r',
  title: 'Dinner at mine',
  emoji: '🍝',
  tile: 'dusk',
  location: 'My place',
  timeOfDay: 'clock',
  usualParts: [],
  firstDate: '2030-01-07',
  lastDate: '2030-01-13',
  daysInRow: 1,
  days: [day('2030-01-12', { from: '19:00' })],
  decide: 'rsvp',
  question: '',
  choices: [],
  spots: 10,
  plusOnes: 1,
  approve: false,
  note: '',
  ...over,
});

function claudeWith(...outputs) {
  const calls = [];
  const anthropic = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            model: 'claude-haiku-5-5',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 10 },
            content: [{ type: 'text', text: JSON.stringify(outputs.shift()) }],
          };
        },
      },
    },
  };
  return { anthropic, calls };
}
const jevSays = (choice, p = 0.95) => {
  const f = async () =>
    new Response(
      JSON.stringify({
        answers: { kind: { type: 'choice', choice, confidence: p, probabilities: { [choice]: p } } },
        usage: { cost: 0.00002 },
      }),
    );
  return f;
};
const ask = (prompt, { claude, jev = null }) =>
  draftAny(jev ? ENV : {}, { prompt, timezone: 'UTC' }, { now: NOW, anthropic: claude.anthropic, fetch: jev ?? undefined });

test('rsvpOf: one day and its time; a start alone runs two hours, and the note says so', () => {
  const out = rsvpOf(read(), { today: TODAY });
  assert.deepEqual(out.when, { date: '2030-01-12', from: 1140, to: 1260 });
  assert.deepEqual(out.rsvp, { cap: 10, plusOnes: 1, approve: false });
  assert.equal(out.said, true);
  assert.equal(out.note, 'Took it as two hours.');
  // A window given is kept as it is.
  assert.deepEqual(rsvpOf(read({ days: [day('2030-01-12', { from: '14:00', to: '17:30' })] }), { today: TODAY }).when, {
    date: '2030-01-12',
    from: 840,
    to: 1050,
  });
});

test('rsvpOf: a part of the day, or a whole day; several days or none give no time', () => {
  const evening = rsvpOf(read({ timeOfDay: 'parts', usualParts: ['evening'], days: [day('2030-01-12')] }), { today: TODAY });
  assert.deepEqual(evening.when, { date: '2030-01-12', from: 1080, to: 1320 });
  assert.equal(evening.note, '');
  const allDay = rsvpOf(read({ timeOfDay: 'any', days: [day('2030-01-12')] }), { today: TODAY });
  assert.deepEqual(allDay.when, { date: '2030-01-12', allDay: true });
  const two = rsvpOf(read({ days: [day('2030-01-11'), day('2030-01-12')] }), { today: TODAY });
  assert.equal(two.dates, 2);
  assert.equal(two.when, null);
  assert.equal(rsvpOf(read({ days: [] }), { today: TODAY }).when, null);
  // Past days don't count.
  assert.equal(rsvpOf(read({ days: [day('2030-01-01'), day('2030-01-12')] }), { today: TODAY }).dates, 1);
});

test('rsvpOf: guest settings stay inside the form’s limits; a time already over today is left to pick', () => {
  assert.deepEqual(rsvpOf(read({ spots: 0, plusOnes: 9, approve: true }), { today: TODAY }).rsvp, {
    cap: null,
    plusOnes: 5,
    approve: true,
  });
  assert.deepEqual(rsvpOf(read({ spots: 5000, plusOnes: -1 }), { today: TODAY }).rsvp, {
    cap: 1000,
    plusOnes: 0,
    approve: false,
  });
  const late = rsvpOf(read({ days: [day(TODAY, { from: '09:00', to: '10:00' })] }), { today: TODAY, nowMinutes: 720 });
  assert.equal(late.when, null);
  assert.match(late.note, /already passed/);
});

test('saidKind and pickKind: RSVP words make an RSVP for one day, a date poll for several', () => {
  for (const t of [
    'RSVP for my birthday drinks',
    'Who’s coming to the BBQ?',
    'Guest list for the launch',
    'Dinner Saturday, plus-ones welcome',
    'Party Friday, 20 spots',
    'Picnic, 12 people max',
  ])
    assert.equal(saidKind(t), 'rsvp', t);
  assert.equal(saidKind('Vote on a restaurant, then RSVP'), 'vote'); // the earlier phrase wins
  assert.equal(saidKind('Dinner with the Smiths next week'), null);
  const one = { dates: 1, said: false };
  assert.deepEqual(pickKind('RSVP for dinner', { days: [] }, one), { kind: 'rsvp', why: 'words' });
  assert.deepEqual(pickKind('RSVP for dinner Fri or Sat', { days: [{ date: 'x' }] }, { dates: 2 }), {
    kind: 'date',
    why: 'words',
  });
  // No words: the read's own "rsvp" with one day.
  assert.deepEqual(pickKind('Dinner at mine Saturday', { days: [] }, { dates: 1, said: true }), { kind: 'rsvp', why: 'fixed' });
  assert.deepEqual(pickKind('Dinner at mine', { days: [{ date: 'a' }] }, { dates: 2, said: true }), {
    kind: 'date',
    why: 'open',
  });
});

test('jevPick: a sure RSVP takes one day at most', () => {
  assert.deepEqual(jevPick({ kind: 'rsvp', p: 0.9 }, { days: [] }, 0.8, { dates: 1 }), { kind: 'rsvp', why: 'fixed' });
  assert.deepEqual(jevPick({ kind: 'rsvp', p: 0.9 }, { days: [] }, 0.8, { dates: 0 }), { kind: 'rsvp', why: 'fixed' });
  assert.equal(jevPick({ kind: 'rsvp', p: 0.9 }, { days: [] }, 0.8, { dates: 3 }), null);
  assert.equal(jevPick({ kind: 'rsvp', p: 0.5 }, { days: [] }, 0.8, { dates: 1 }), null);
});

test('draftAny: Jev says RSVP, Claude’s read fills it in, in one model call', async () => {
  const claude = claudeWith(read());
  const out = await ask('dinner at mine Sat 7pm, 10 people max, plus-ones ok', { claude, jev: jevSays('rsvp') });
  assert.equal(claude.calls.length, 1);
  assert.equal(out.kind, 'rsvp');
  assert.equal(out.by, 'jev');
  assert.equal(out.title, 'Dinner at mine');
  assert.equal(out.emoji, '🍝');
  assert.equal(out.location, 'My place');
  assert.deepEqual(out.when, { date: '2030-01-12', from: 1140, to: 1260 });
  assert.deepEqual(out.rsvp, { cap: 10, plusOnes: 1, approve: false });
  assert.equal(out.note, 'Took it as two hours.');
  // RSVP is one of the kinds Jev is asked about.
  assert.ok(cleanUsage('ai.used', { feature: 'ask', picked: 'rsvp', why: 'fixed', by: 'jev' }));
});

test('draftAny: without Jev, the read’s RSVP decides; several days make a date poll instead', async () => {
  const out = await ask('Book club is on Thursday, see who can come', {
    claude: claudeWith(read({ title: 'Book club', days: [day('2030-01-10')], timeOfDay: 'any', spots: 0, plusOnes: 0 })),
  });
  assert.equal(out.kind, 'rsvp');
  assert.equal(out.by, 'claude');
  assert.deepEqual(out.when, { date: '2030-01-10', allDay: true });
  assert.deepEqual(out.rsvp, { cap: null, plusOnes: 0, approve: false });
  const date = await ask('Dinner at mine', {
    claude: claudeWith(read({ timeOfDay: 'any', days: [day('2030-01-10'), day('2030-01-11')] })),
  });
  assert.equal(date.kind, 'date');
  assert.equal(date.days.length, 2);
});
