// "Use AI" on Create a Venn: a fixed set of prompts, checked layer by layer without a live model.
//
//   A. The server: a realistic model answer (what a model following DAYS_SYSTEM gives) goes through
//      POST /api/ai/draft-days with a fake Claude, and the draft must keep every stated limit.
//   B. No AI: the same prompt through the plain-words reader (src/days-parse.js). It may give no
//      draft (the page goes on as before), but a draft it gives must be right.
//   C. Agreement: the draft goes into the form's picks as public/ai-draft.js puts it there, is said
//      in words as the page says it (draft-summary.js), and is published as create-free.js publishes
//      it. The published poll's slots and the organizer's own answers must match the draft exactly.
//
// None of this runs the real model: scripts/ai-eval.js does that, with a key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../server.js';
import { DAY_PARTS, IF_NEEDED, YES, hostAnswer, zonedToUtc } from '../public/core.js';
import { draftFromWords, unsureOf } from '../src/days-parse.js';

globalThis.document ??= { getElementById: () => null };
const { describeDraft } = await import('../public/draft-summary.js');
const { windowsAt, toWindows } = await import('../public/levels.js');

const NY = 'America/New_York';
const TUE = zonedToUtc('2026-11-03', 600, NY); // Tuesday 10:00 in New York, the sprint's day

// ---------- the model's answers, as a model following the rules gives them ----------

const answer = (more) => ({
  reading: '',
  title: '',
  emoji: '',
  tile: 'paper',
  location: '',
  timeOfDay: 'any',
  usualParts: [],
  firstDate: '',
  lastDate: '',
  daysInRow: 1,
  decide: 'when',
  question: '',
  choices: [],
  note: '',
  ...more,
  days: (more.days || []).map((d) => ({
    parts: [],
    from: '',
    to: '',
    ifNeeded: false,
    ...(typeof d === 'string' ? { date: d } : d),
  })),
});
const W = (dates, part) => dates.map((d) => `${d} ${part}`);
const H = (dates, from, to) => dates.map((d) => `${d} ${from}-${to}`);
const NEXT_WEEK = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];

/**
 * Each case: the prompt, the model's answer, and what must come out: `vote` ('what' | 'both'),
 * `level`, `row`, the windows (`want`), the if-needed days, and what the note must say. `words` is
 * what the no-AI reader must give: 'same' (the same windows), null (no draft is fine), or a reason
 * it's known to be wrong (the case is then a todo for that layer, with the defect's id).
 */
const CASES = [
  {
    id: 'Q1 date night regression',
    prompt: "I'm only free Wednesday, Thursday, and the weekend this week. Create a date poll for a date night with my wife.",
    model: answer({
      reading: 'Wed, Thu, Sat, Sun this week; date night implies evening',
      title: 'Date night',
      emoji: '❤️',
      tile: 'berry',
      timeOfDay: 'parts',
      usualParts: ['evening'],
      firstDate: '2026-11-04',
      lastDate: '2026-11-08',
      days: ['2026-11-04', '2026-11-05', '2026-11-07', '2026-11-08'],
      note: 'Took date night as evenings.',
    }),
    level: 'parts',
    want: W(['2026-11-04', '2026-11-05', '2026-11-07', '2026-11-08'], 'evening'),
    note: /evening/i,
    when: 'Evenings: Wed, Nov 4 · Thu, Nov 5 · Sat, Nov 7 · Sun, Nov 8',
    words: 'same',
  },
  {
    id: 'Q1b date night, model slip: says parts but leaves usualParts empty',
    prompt: "I'm only free Wednesday, Thursday, and the weekend this week. Create a date poll for a date night with my wife.",
    model: answer({
      reading: 'Wed, Thu, Sat, Sun this week; date night implies evening',
      title: 'Date night',
      timeOfDay: 'parts',
      usualParts: [],
      firstDate: '2026-11-04',
      lastDate: '2026-11-08',
      days: ['2026-11-04', '2026-11-05', '2026-11-07', '2026-11-08'],
    }),
    // The person's own words imply the part: date night is evenings, on the allowed days, said (D5).
    level: 'parts',
    want: W(['2026-11-04', '2026-11-05', '2026-11-07', '2026-11-08'], 'evening'),
    note: /Took date night as evenings\./,
    when: 'Evenings: Wed, Nov 4 · Thu, Nov 5 · Sat, Nov 7 · Sun, Nov 8',
    words: 'same',
  },
  {
    id: 'Q1c model slip: says parts, names none, and the words imply none',
    prompt: 'Catch up with Sam on Wednesday or Thursday',
    model: answer({ title: 'Catch up with Sam', timeOfDay: 'parts', usualParts: [], days: ['2026-11-04', '2026-11-05'] }),
    level: 'days',
    want: W(['2026-11-04', '2026-11-05'], 'all'),
    note: /No part of the day was given, so it asks about whole days\./,
    words: 'same',
  },
  {
    id: 'Q2 format: a choice is a vote',
    prompt: 'Choose between Italian, Thai and Mexican for dinner',
    model: answer({ decide: 'what', question: 'Where should we eat?', choices: ['Italian', 'Thai', 'Mexican'] }),
    vote: 'what',
    options: 3,
    words: null,
  },
  {
    id: 'Q3 mixed what and when',
    prompt: "Let's decide where and when to have dinner this week",
    model: answer({
      title: 'Dinner',
      decide: 'both',
      question: 'Where should we have dinner?',
      timeOfDay: 'parts',
      usualParts: ['evening'],
      firstDate: '2026-11-03',
      lastDate: '2026-11-08',
      days: ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'],
    }),
    vote: 'both',
    level: 'parts',
    want: W(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'], 'evening'),
    words: null,
  },
  {
    id: 'Q4 format: a plan is dates, days in a row',
    prompt: 'Which weekend works for a cabin trip?',
    model: answer({
      title: 'Cabin trip',
      daysInRow: 2,
      firstDate: '2026-11-07',
      lastDate: '2026-11-22',
      days: ['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22'],
      note: 'Took it as Saturday and Sunday in the next three weeks.',
    }),
    level: 'days',
    row: 2,
    want: W(['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22'], 'all'),
    words: 'same',
  },
  {
    id: 'Q5 constraint: except Monday',
    prompt: 'Dinner any evening next week except Monday',
    model: answer({
      title: 'Dinner',
      timeOfDay: 'parts',
      usualParts: ['evening'],
      firstDate: '2026-11-09',
      lastDate: '2026-11-15',
      days: NEXT_WEEK.slice(1),
    }),
    level: 'parts',
    want: W(NEXT_WEEK.slice(1), 'evening'),
    words: null,
  },
  {
    id: 'Q6 constraint: a preference keeps both, the rest if needed',
    prompt: 'Drinks next week, ideally the weekend but weeknights work too',
    model: answer({
      title: 'Drinks',
      timeOfDay: 'parts',
      usualParts: ['evening'],
      firstDate: '2026-11-09',
      lastDate: '2026-11-15',
      days: NEXT_WEEK.map((date, i) => ({ date, ifNeeded: i < 5 })),
    }),
    level: 'parts',
    want: W(NEXT_WEEK, 'evening'),
    ifNeeded: NEXT_WEEK.slice(0, 5),
    words: null,
  },
  {
    id: 'Q7 granularity: whole days',
    prompt: 'Beach day, any Saturday in November',
    model: answer({
      title: 'Beach day',
      firstDate: '2026-11-07',
      lastDate: '2026-11-28',
      days: ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'],
    }),
    level: 'days',
    want: W(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'], 'all'),
    words: 'same',
  },
  {
    id: 'Q8 granularity: clock times',
    prompt: 'Team sync Wednesday or Thursday 2–4pm',
    model: answer({
      title: 'Team sync',
      timeOfDay: 'clock',
      firstDate: '2026-11-04',
      lastDate: '2026-11-05',
      days: [
        { date: '2026-11-04', from: '14:00', to: '16:00' },
        { date: '2026-11-05', from: '14:00', to: '16:00' },
      ],
    }),
    level: 'hours',
    want: H(['2026-11-04', '2026-11-05'], 840, 960),
    words: null,
  },
  {
    id: 'Q9 granularity: an open-ended window',
    prompt: 'Call after 6pm on Wednesday or Friday',
    model: answer({
      title: 'Call',
      timeOfDay: 'clock',
      days: [
        { date: '2026-11-04', from: '18:00', to: '24:00' },
        { date: '2026-11-06', from: '18:00', to: '24:00' },
      ],
    }),
    level: 'hours',
    want: H(['2026-11-04', '2026-11-06'], 1080, 1440),
    words: null,
  },
  {
    id: 'Q10 contradiction: a later correction wins',
    prompt: 'Dinner Tuesday evening, actually make it Wednesday',
    model: answer({
      title: 'Dinner',
      timeOfDay: 'parts',
      usualParts: ['evening'],
      days: ['2026-11-04'],
      note: 'Went with Wednesday, as corrected.',
    }),
    level: 'parts',
    want: ['2026-11-04 evening'],
    words: null, // no draft, and the box says to say it in one go
    unsure: 'correction',
  },
  {
    id: 'Q11 contradiction: what is stated beats what the plan implies',
    prompt: 'Date night, but only afternoons, Friday or Saturday',
    model: answer({
      title: 'Date night',
      timeOfDay: 'parts',
      usualParts: ['afternoon'],
      days: ['2026-11-06', '2026-11-07'],
    }),
    level: 'parts',
    want: W(['2026-11-06', '2026-11-07'], 'afternoon'),
    words: 'same',
  },
  {
    id: 'Q12 constraint: each day keeps its own part',
    prompt: 'Friday evening or Saturday afternoon',
    model: answer({
      timeOfDay: 'parts',
      days: [
        { date: '2026-11-06', parts: ['evening'] },
        { date: '2026-11-07', parts: ['afternoon'] },
      ],
    }),
    level: 'parts',
    want: ['2026-11-06 evening', '2026-11-07 afternoon'],
    words: null, // no draft, and the box says to say one time for all the days
    unsure: 'parts',
  },
  {
    id: 'Q12b constraint: any time one day, one part the other',
    prompt: 'Saturday any time or Sunday evening',
    model: answer({
      timeOfDay: 'parts',
      days: [
        { date: '2026-11-07', parts: ['morning', 'afternoon', 'evening'] },
        { date: '2026-11-08', parts: ['evening'] },
      ],
    }),
    level: 'parts',
    want: [...W(['2026-11-07'], 'morning'), ...W(['2026-11-07'], 'afternoon'), '2026-11-07 evening', '2026-11-08 evening'],
    words: null,
    unsure: 'parts',
  },
  {
    id: 'Q13 ambiguity: "next weekend" on a Tuesday, the reading said',
    prompt: 'Brunch next weekend',
    model: answer({
      title: 'Brunch',
      timeOfDay: 'parts',
      usualParts: ['morning'],
      days: ['2026-11-14', '2026-11-15'],
      note: 'Took next weekend as Nov 14–15, not this coming one.',
    }),
    level: 'parts',
    want: W(['2026-11-14', '2026-11-15'], 'morning'),
    note: /next weekend/i,
    words: 'same',
    wordsNote: /weekend/i,
    todoWordsNote: 'D6: which weekend "next weekend" is goes unsaid (and DAYS_SYSTEM does not define it)',
  },
  {
    id: 'Q14 a window past midnight is cut there, and said',
    prompt: 'Party Saturday 9pm to 2am',
    model: answer({ title: 'Party', timeOfDay: 'clock', days: [{ date: '2026-11-07', from: '21:00', to: '02:00' }] }),
    level: 'hours',
    want: ['2026-11-07 1260-1440'],
    note: /midnight/,
    words: null,
  },
  {
    id: 'Q15 day abbreviations: weds and thurs',
    prompt: 'Dinner weds or thurs this week',
    model: answer({ title: 'Dinner', timeOfDay: 'parts', usualParts: ['evening'], days: ['2026-11-04', '2026-11-05'] }),
    level: 'parts',
    want: W(['2026-11-04', '2026-11-05'], 'evening'),
    words: 'same',
  },
  {
    id: 'Q16 implied part of the day, said plainly',
    prompt: 'Lunch Wednesday or Friday',
    model: answer({
      title: 'Lunch',
      timeOfDay: 'parts',
      usualParts: ['afternoon'],
      days: ['2026-11-04', '2026-11-06'],
      note: 'Took lunch as afternoons.',
    }),
    level: 'parts',
    want: W(['2026-11-04', '2026-11-06'], 'afternoon'),
    note: /lunch/i,
    words: 'same',
    wordsNote: /^(?!.*undefined).*lunch/i,
  },
  {
    id: 'Q17 a word that is also a day: "the sun"',
    prompt: 'Picnic in the sun on Saturday',
    model: answer({ title: 'Picnic', days: ['2026-11-07'] }),
    level: 'days',
    want: ['2026-11-07 all'],
    words: 'same',
  },
  {
    id: 'Q18 "make it" as in coming along is no correction',
    prompt: 'Who can make it Friday or Saturday?',
    model: answer({ title: 'Get-together', days: ['2026-11-06', '2026-11-07'] }),
    level: 'days',
    want: W(['2026-11-06', '2026-11-07'], 'all'),
    words: 'same',
  },
];

// ---------- the server, with a fake Claude that gives each case's answer ----------

let server, baseUrl;
let next = null; // what the fake Claude does next: an answer, or a function that throws
const fake = {
  beta: {
    messages: {
      create: async () => {
        const out = typeof next === 'function' ? next() : next;
        return {
          stop_reason: 'end_turn',
          model: 'claude-haiku-5-5',
          usage: {},
          content: [{ type: 'text', text: JSON.stringify(out) }],
        };
      },
    },
  },
};
before(async () => {
  server = createApp({
    dbPath: ':memory:',
    env: { ANTHROPIC_API_KEY: 'sk-test', AI_RATE_LIMIT: '1000', AI_WEEKLY_LIMIT: '1000', CREATE_RATE_LIMIT: '0' },
    anthropic: fake,
    now: () => TUE,
  });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, body) {
  const res = await fetch(baseUrl + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

// ---------- the checks ----------

const key = (d) => `${d.date} ${d.part ?? (d.start != null ? `${d.start}-${d.end}` : 'all')}`;
const sameWindows = (draft, c) => assert.deepEqual(draft.days.map(key).sort(), [...c.want].sort());
function checkDraft(draft, c) {
  if (c.vote) {
    assert.equal(draft.vote?.both ? 'both' : draft.vote ? 'what' : 'when', c.vote, 'what the group decides');
    if (c.options) assert.equal(draft.vote.options.length, c.options);
    if (c.vote === 'what') return assert.equal(draft.days.length, 0);
  }
  assert.equal(draft.level, c.level, 'how precise');
  if (c.row) assert.equal(draft.row, c.row, 'days in a row');
  sameWindows(draft, c);
  const maybe = [...new Set(draft.days.filter((d) => d.ifNeeded).map((d) => d.date))].sort();
  assert.deepEqual(maybe, c.ifNeeded || [], 'if needed');
}

/** The picks the form holds after Use AI, as public/ai-draft.js (aiDays) puts them there. */
function picksOf(draft) {
  const st = { days: new Set(), parts: new Set(), hours: new Set() };
  const maybe = { days: new Set(), parts: new Set(), hours: new Set() };
  const pick = (k, ifNeeded) => {
    st[draft.level].add(k);
    if (ifNeeded) maybe[draft.level].add(k);
  };
  for (const d of draft.days.slice(0, 62))
    if (draft.level === 'hours') for (let m = d.start; m < d.end; m += 30) pick(`${d.date}|${m}`, d.ifNeeded);
    else if (draft.level === 'parts') pick(`${d.date}|${DAY_PARTS.find((p) => p.key === d.part).start}`, d.ifNeeded);
    else pick(d.date, d.ifNeeded);
  return { ...st, maybe };
}

/** The poll create-free.js publishes from those picks, with the organizer's own answer. */
function pollOf(draft, st, tz) {
  const lv = draft.level;
  const body =
    lv === 'hours'
      ? { windows: toWindows(st.hours), slotMinutes: 30, durationMinutes: 30, anyLength: true }
      : lv === 'parts'
        ? {
            mode: 'options',
            layout: 'parts',
            options: windowsAt(st, 'parts').map((w) => ({
              start: zonedToUtc(w.date, w.start, tz),
              end: zonedToUtc(w.date, w.end, tz),
            })),
          }
        : {
            dates: [...st.days].sort(),
            startMinute: 0,
            endMinute: 1440,
            slotMinutes: 1440,
            durationMinutes: (draft.row || 1) * 1440,
          };
  return {
    ...body,
    title: draft.title || 'Plan',
    organizer: 'Quinn',
    timezone: tz,
    hostAnswers: true,
    hostAvailability: hostAnswer(st[lv], st.maybe[lv], tz),
  };
}

const MON3 = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
/** The dates a summary line names (in 2026), with "Tue, Nov 3 – Sun, Nov 8" read as every day between. */
function saidDates(line) {
  const out = new Set();
  const iso = (mon, day) => `2026-${String(MON3.indexOf(mon) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  for (const seg of line.replace(/^[^:]*: /, '').split(/ · |; [^:]*: /)) {
    const found = [...seg.matchAll(/([A-Z][a-z]{2}) (\d{1,2})/g)].map((m) => iso(m[1], +m[2]));
    if (seg.includes('–') && found.length === 2)
      for (let d = found[0]; d <= found[1]; d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) out.add(d);
    else found.forEach((d) => out.add(d));
  }
  return [...out].sort();
}

/** What the published poll should ask about: each window's slots, as instants. */
function expectedSlots(draft, tz) {
  const out = [];
  for (const d of draft.days)
    if (draft.level === 'days') out.push(zonedToUtc(d.date, 0, tz));
    else if (draft.level === 'parts') out.push(zonedToUtc(d.date, DAY_PARTS.find((p) => p.key === d.part).start, tz));
    else for (let m = d.start; m < d.end; m += 30) out.push(zonedToUtc(d.date, m, tz));
  return out.sort((a, b) => a - b);
}

for (const c of CASES) {
  test(`${c.id} · A server`, { todo: c.todoA }, async () => {
    next = c.model;
    const { status, data: draft } = await call('/api/ai/draft-days', { prompt: c.prompt, timezone: NY });
    assert.equal(status, 200, JSON.stringify(draft));
    checkDraft(draft, c);
    if (c.note) assert.match(draft.note, c.note, 'the assumption is said');
    if (c.when) assert.equal(describeDraft(draft, draft.title).when, c.when);
  });

  const knownWrong = typeof c.words === 'string' && c.words !== 'same' ? c.words : undefined;
  test(`${c.id} · B no AI`, { todo: knownWrong }, () => {
    const draft = draftFromWords(c.prompt, { today: '2026-11-03', nowMinutes: 600, ai: true });
    if (c.unsure) {
      assert.equal(draft, null, 'no draft rather than a wrong one');
      return assert.equal(unsureOf(c.prompt), c.unsure, 'and why, so the box says what to change');
    }
    if (c.words === null) return assert.ok(!draft || checkDraft(draft, c) === undefined, 'no draft, or a right one');
    assert.ok(draft, 'a draft from the words');
    checkDraft(draft, c);
  });
  if (c.wordsNote)
    test(`${c.id} · B no AI, the note`, { todo: c.todoWordsNote }, () => {
      const draft = draftFromWords(c.prompt, { today: '2026-11-03', nowMinutes: 600, ai: true });
      assert.match(draft.note, c.wordsNote);
    });

  if (c.vote !== 'what')
    test(`${c.id} · C draft, form and published poll agree`, async () => {
      next = c.model;
      const { data: draft } = await call('/api/ai/draft-days', { prompt: c.prompt, timezone: NY });
      const st = picksOf(draft);
      // The summary names exactly the draft's days: each one, or a run of days "Nov 3 – Nov 8".
      const said = describeDraft(draft, draft.title).when;
      assert.deepEqual(saidDates(said), [...new Set(draft.days.map((x) => x.date))].sort(), said);
      const created = await call('/api/events', pollOf(draft, st, NY));
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const ev = (await call(`/api/events/${created.data.id}`)).data;
      assert.deepEqual(
        [...ev.slots].sort((a, b) => a - b),
        expectedSlots(draft, NY),
        'the poll asks about exactly the draft',
      );
      // The organizer's own answer: yes where available, if needed where optional, on those slots only.
      const host = ev.participants.find((p) => p.name === 'Quinn');
      const answers = Object.entries(host.availability).filter(([, v]) => v);
      assert.equal(answers.length, ev.slots.length);
      const maybe = new Set(draft.days.filter((d) => d.ifNeeded).map((d) => d.date));
      for (const [slot, v] of answers) {
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(Number(slot));
        assert.equal(v, maybe.has(date) ? IF_NEEDED : YES, `the organizer's answer on ${date}`);
      }
    });
}

// ---------- failure and retry ----------

test('failure, then retry: an overloaded model is a 503 with what to do; asking again works', async () => {
  next = () => {
    throw new Anthropic.InternalServerError(
      529,
      { error: { type: 'overloaded_error', message: 'Overloaded' } },
      'Overloaded',
      new Headers(),
    );
  };
  const failed = await call('/api/ai/draft-days', { prompt: 'Dinner Friday', timezone: NY });
  assert.equal(failed.status, 503);
  assert.match(failed.data.error, /try again/i);
  next = answer({ title: 'Dinner', timeOfDay: 'parts', usualParts: ['evening'], days: ['2026-11-06'] });
  const again = await call('/api/ai/draft-days', { prompt: 'Dinner Friday', timezone: NY });
  assert.equal(again.status, 200);
  assert.deepEqual(again.data.days.map(key), ['2026-11-06 evening']);
});

test('failure: an answer with no days, or one that is not JSON, says so and changes nothing', async () => {
  next = answer({ title: 'Lunch' });
  const none = await call('/api/ai/draft-days', { prompt: 'Lunch sometime', timezone: NY });
  assert.equal(none.status, 503);
  assert.match(none.data.error, /Try mentioning when/);
  const bad = {
    beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":' }] }) } },
  };
  const { draftDays } = await import('../src/ai.js');
  await assert.rejects(draftDays({}, { prompt: 'Lunch', timezone: NY }, { now: TUE, anthropic: bad }), /unexpected/);
});
