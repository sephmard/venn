// Jev (src/jev.js), the fixed poll-kind cases (src/kind-cases.js) and the hourly check that scores
// Jev against today's picker on them (src/kind-check.js). No real request leaves the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore, sqliteAdapter } from '../src/store.js';
import { askJev, casesForHour, JEV_MODEL, JEV_URL, jevEnabled, jevKind, KIND_QUESTION } from '../src/jev.js';
import { KIND_CASES, KINDS } from '../src/kind-cases.js';
import { checkKinds } from '../src/kind-check.js';
import { choicesOfWords, saidKind } from '../src/ask-kind.js';
import { cleanUsage } from '../src/usage.js';
import { weekOf } from '../src/ai.js';

const KEY = 'sk-or-v1-test-key-not-real';
const ENV = { JEV_API_KEY_OPENROUTER: KEY };
const answer = (choice, p = 0.9, cost = 0.00002) => ({
  answers: { kind: { type: 'choice', choice, confidence: p, probabilities: { [choice]: p } } },
  usage: { input_tokens: 120, output_tokens: 5, cost },
});
function fakeFetch(reply = answer('date'), { status = 200 } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(typeof reply === 'function' ? reply(JSON.parse(init.body)) : reply), { status });
  };
  f.calls = calls;
  return f;
}
const quietly = async (fn) => {
  const was = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a);
  try {
    return { out: await fn(), logged };
  } finally {
    console.error = was;
  }
};

test('Jev is off without its key, and then nothing is sent', async () => {
  const f = fakeFetch();
  assert.equal(jevEnabled({}), false);
  assert.equal(await askJev({}, { state: 'x', questions: {} }, { fetch: f }), null);
  assert.equal(await jevKind({ JEV_API_KEY_OPENROUTER: '' }, 'Dinner Friday', { fetch: f }), null);
  assert.equal(f.calls.length, 0);
});

test('a request goes to OpenRouter’s Decisions API with the key only in its authorization header', async () => {
  const f = fakeFetch();
  const out = await jevKind(ENV, 'Dinner with the Smiths next week', { fetch: f });
  assert.deepEqual(out, { kind: 'date', p: 0.9, cost: 20 });
  const [{ url, init, body }] = f.calls;
  assert.equal(url, JEV_URL);
  assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
  assert.ok(!url.includes(KEY));
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  assert.ok(!init.body.includes(KEY));
  assert.equal(body.model, JEV_MODEL);
  assert.equal(body.state, 'Dinner with the Smiths next week');
  assert.deepEqual(body.questions, { kind: KIND_QUESTION });
  assert.deepEqual(Object.keys(KIND_QUESTION.criteria), KINDS);
  assert.ok(init.signal, 'a request has a timeout');
  // JEV_MODEL picks another release.
  await jevKind({ ...ENV, JEV_MODEL: '~typesafe/jev-latest' }, 'x', { fetch: f });
  assert.equal(f.calls[1].body.model, '~typesafe/jev-latest');
});

test('when Jev can’t answer, Venn gets null, and the log has the status but never the key or the text', async () => {
  for (const [f, want] of [
    [fakeFetch({ error: { code: 401, message: `bad key ${KEY}` } }, { status: 401 }), { status: 401 }],
    [fakeFetch({ error: { code: 402 } }, { status: 402 }), { status: 402 }],
    [fakeFetch(new TypeError('fetch failed')), { reason: 'connection' }],
    [fakeFetch(Object.assign(new Error('slow'), { name: 'TimeoutError' })), { reason: 'timeout' }],
  ]) {
    const { out, logged } = await quietly(() => jevKind(ENV, 'my secret plan', { fetch: f }));
    assert.equal(out, null);
    assert.deepEqual(logged, [['Jev request failed', want]]);
    assert.ok(!JSON.stringify(logged).includes(KEY) && !JSON.stringify(logged).includes('secret plan'));
  }
  // An answer that isn't one of the kinds, or no answer at all.
  assert.equal(await jevKind(ENV, 'x', { fetch: fakeFetch(answer('maybe')) }), null);
  assert.equal(await jevKind(ENV, 'x', { fetch: fakeFetch({ answers: {} }) }), null);
  assert.equal(await jevKind(ENV, 'x', { fetch: fakeFetch({}) }), null);
});

test('the fixed cases: about 50, unique, every kind, and short enough to send', () => {
  assert.ok(KIND_CASES.length >= 45 && KIND_CASES.length <= 60);
  assert.equal(new Set(KIND_CASES.map((c) => c.id)).size, KIND_CASES.length);
  assert.equal(new Set(KIND_CASES.map((c) => c.text.toLowerCase())).size, KIND_CASES.length);
  for (const k of KINDS)
    assert.ok(
      KIND_CASES.some((c) => c.kind === k),
      k,
    );
  for (const c of KIND_CASES) assert.ok(KINDS.includes(c.kind) && c.text.length <= 600, c.id);
  // Seph's question, which first showed the picker going wrong (#286).
  assert.equal(KIND_CASES.find((c) => c.id === 'k01').kind, 'yesno');
});

test('the baseline: the word rules alone settle 14 of the 55 cases right', () => {
  // Today's picker settles a case by its words first (saidKind, then choicesOfWords without AI);
  // the rest is the Claude read, which only the server's check can score. Pinned, so the number in
  // docs/AI.md can't drift without the test saying so.
  const rules = (text) => {
    const said = saidKind(text);
    if (said) return said;
    const w = choicesOfWords(text);
    return w ? (w.yesNo ? 'yesno' : 'vote') : null;
  };
  const right = KIND_CASES.filter((c) => rules(c.text) === c.kind).map((c) => c.id);
  const wrong = KIND_CASES.filter((c) => rules(c.text) && rules(c.text) !== c.kind).map((c) => c.id);
  assert.equal(right.length, 14);
  assert.deepEqual(wrong, ['k20', 'k21']); // "which works better, Thursday or Friday?" reads as a vote
});

test('the check covers every case once a day, 5 an hour in the first 11 hours (UTC)', () => {
  const seen = [];
  for (let h = 0; h < 24; h++) {
    const cases = casesForHour(h);
    assert.ok(cases.length <= 5);
    if (h >= 11) assert.equal(cases.length, 0, `hour ${h}`);
    seen.push(...cases.map((c) => c.id));
  }
  assert.deepEqual(
    seen,
    KIND_CASES.map((c) => c.id),
  );
});

test('every check result is a usage count the stats accept', () => {
  for (const c of KIND_CASES)
    for (const got of [...KINDS, 'error']) {
      assert.ok(cleanUsage('kind.check', { case: c.id, by: 'jev', got, sure: 'yes' }));
      assert.ok(cleanUsage('kind.check', { case: c.id, by: 'claude', got }));
    }
  assert.equal(cleanUsage('kind.check', { case: 'a real sentence', by: 'jev', got: 'date' }), null);
});

const HOUR0 = Date.UTC(2026, 10, 9, 0, 0); // a Monday, 00:00 UTC: cases k01–k05
const statsEnv = { ...ENV, STATS_TOKEN: 't' };
const newStore = () => createStore(sqliteAdapter(new DatabaseSync(':memory:')));
const countsOf = async (store) =>
  (await store.listUsage('2026-01-01')).filter((r) => r.name === 'kind.check').map((r) => JSON.parse(r.props));

test('the hourly check sends only the fixed sentences, counts each answer, and adds Jev’s cost to the weekly spend', async () => {
  const store = newStore();
  const sent = [];
  const f = fakeFetch((body) => {
    sent.push(body.state);
    return answer(KIND_CASES.find((c) => c.text === body.state).kind, 0.95);
  });
  const counted = await checkKinds({ store, env: statsEnv, now: HOUR0, fetch: f });
  assert.deepEqual(
    sent,
    KIND_CASES.slice(0, 5).map((c) => c.text),
  );
  assert.deepEqual(
    counted,
    KIND_CASES.slice(0, 5).map((c) => ({ case: c.id, by: 'jev', got: c.kind, sure: 'yes' })),
  );
  assert.deepEqual(await countsOf(store), counted);
  assert.equal(await store.aiSpend(weekOf(HOUR0)), 100); // 5 × $0.00002
  // Hours with no cases, no Jev, or no stats to count into: nothing is sent.
  for (const [env, now] of [
    [statsEnv, HOUR0 + 12 * 3600_000],
    [{ STATS_TOKEN: 't' }, HOUR0],
    [ENV, HOUR0],
  ])
    assert.deepEqual(await checkKinds({ store: newStore(), env, now, fetch: f }), []);
  assert.equal(sent.length, 5);
});

test('the check stops at the weekly dollar cap, and counts a failed or unsure answer', async () => {
  const store = newStore();
  await store.addAiSpend(weekOf(HOUR0), 5_000_000); // $5, the default cap
  const f = fakeFetch(answer('vote', 0.5));
  assert.deepEqual(await checkKinds({ store, env: statsEnv, now: HOUR0, fetch: f }), []);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(
    await checkKinds({ store: newStore(), env: { ...statsEnv, AI_WEEKLY_BUDGET_USD: '0' }, now: HOUR0, fetch: f }),
    [],
  );

  const unsure = await checkKinds({ store: newStore(), env: statsEnv, now: HOUR0, fetch: f });
  assert.deepEqual(unsure[0], { case: 'k01', by: 'jev', got: 'vote', sure: 'no' });
  const { out: failed } = await quietly(() =>
    checkKinds({ store: newStore(), env: statsEnv, now: HOUR0, fetch: fakeFetch({}, { status: 503 }) }),
  );
  assert.deepEqual(failed[0], { case: 'k01', by: 'jev', got: 'error', sure: 'no' });
});

test('with the server’s Claude key too, today’s picker answers the same cases, metered into the same spend', async () => {
  const store = newStore();
  const calls = [];
  // The days model reads each case; this one reads every sentence as a vote on two named things.
  const anthropic = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const text = JSON.stringify({
            reading: 'r',
            title: 'Plan',
            emoji: '🍕',
            tile: 'sunset',
            location: '',
            timeOfDay: 'any',
            usualParts: [],
            firstDate: '',
            lastDate: '',
            daysInRow: 1,
            days: [],
            decide: 'what',
            question: 'Which?',
            choices: ['A', 'B'],
            note: '',
          });
          return {
            model: 'claude-haiku-5-5',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1000, output_tokens: 100 },
            content: [{ type: 'text', text }],
          };
        },
      },
    },
  };
  const env = { ...statsEnv, ANTHROPIC_API_KEY: 'sk-ant-test' };
  const counted = await checkKinds({ store, env, now: HOUR0, fetch: fakeFetch(answer('date')), anthropic });
  const claude = counted.filter((c) => c.by === 'claude');
  assert.equal(claude.length, 5);
  assert.equal(calls.length, 5);
  // k01's words name no choice ("ask my wife if…"), so the model's read decides: a vote.
  assert.deepEqual(claude[0], { case: 'k01', by: 'claude', got: 'vote', filled: 'yes' });
  // k07 "When can everyone do a call?" is a date poll by its words, but the read gave no days.
  assert.ok(claude.every((c) => KINDS.includes(c.got) || c.got === 'error'));
  assert.ok((await store.aiSpend(weekOf(HOUR0))) > 100, 'Claude’s cost is counted too');
});

// ---------- Jev in real requests: it picks the kind when it's sure, Claude writes the poll ----------

import { draftAny } from '../src/ai.js';
import { jevPick } from '../src/ask-kind.js';

test('jevPick: only a sure answer the read can fill in; "nothing" and unsure answers defer', () => {
  const days = { days: [{ date: '2030-01-10' }], vote: null };
  const choices = { days: [], vote: { question: 'Where?', options: ['A', 'B'], both: false } };
  const none = { days: [], vote: null };
  assert.equal(jevPick(null, days), null);
  assert.equal(jevPick({ kind: 'date', p: 0.79 }, days), null);
  assert.deepEqual(jevPick({ kind: 'date', p: 0.8 }, days), { kind: 'date', why: 'open' });
  assert.equal(jevPick({ kind: 'date', p: 0.99 }, none), null); // no days to fill a date poll with
  assert.deepEqual(jevPick({ kind: 'vote', p: 0.9 }, choices), { kind: 'vote', why: 'open' });
  assert.deepEqual(jevPick({ kind: 'vote', p: 0.9 }, none), { kind: 'vote', why: 'question' });
  assert.deepEqual(jevPick({ kind: 'vote', p: 0.9 }, { ...choices, days: days.days }), { kind: 'vote', why: 'both' });
  // Days found but nothing named ("pick a restaurant for dinner next week"): the vote comes first.
  assert.deepEqual(jevPick({ kind: 'vote', p: 0.9 }, days), { kind: 'vote', why: 'both' });
  assert.deepEqual(jevPick({ kind: 'yesno', p: 0.9 }, days), { kind: 'vote', why: 'question', yesNo: true });
  assert.equal(jevPick({ kind: 'none', p: 0.99 }, days), null);
});

/** A Claude stand-in: the days model's read, then (if asked) the vote writer's. */
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
const read = (over = {}) => ({
  reading: 'r',
  title: 'Plan',
  emoji: '🍕',
  tile: 'sunset',
  location: '',
  timeOfDay: 'any',
  usualParts: [],
  firstDate: '2030-01-07',
  lastDate: '2030-01-13',
  daysInRow: 1,
  days: [],
  decide: 'when',
  question: '',
  choices: [],
  note: '',
  ...over,
});
const day = (date) => ({ date, parts: [], from: '', to: '', ifNeeded: false });
const NOW = Date.UTC(2030, 0, 7, 12); // a Monday
const ask = (prompt, { jev, claude, env = ENV }) =>
  draftAny(env, { prompt, timezone: 'UTC' }, { now: NOW, anthropic: claude.anthropic, fetch: jev });

test('Jev sure it’s yes or no: a yes-or-no vote, even where Claude read a time to find; Claude writes the question', async () => {
  const jev = fakeFetch(answer('yesno', 0.97));
  const claude = claudeWith(read({ decide: 'when' }), {
    question: 'Do you think I’m cute?',
    yesNo: false,
    options: ['Yes', 'Very'],
  });
  const out = await ask('I want to ask my wife if she thinks I’m cute', { jev, claude });
  assert.equal(out.kind, 'vote');
  assert.equal(out.by, 'jev');
  assert.equal(out.yesNo, true);
  assert.deepEqual(out.options, []);
  assert.equal(out.question, 'Do you think I’m cute?');
  // Only the sentence went to Jev, asked not to be kept.
  assert.equal(jev.calls[0].body.state, 'I want to ask my wife if she thinks I’m cute');
  assert.deepEqual(jev.calls[0].body.provider, { data_collection: 'deny' });
});

test('Jev sure it’s a date poll wins over words that read as a vote; Claude’s days fill it', async () => {
  const jev = fakeFetch(answer('date', 0.95));
  const claude = claudeWith(read({ days: [day('2030-01-10'), day('2030-01-11')] }));
  const out = await ask('Dinner with the team, which works better, Thursday or Friday?', { jev, claude });
  assert.equal(out.kind, 'date');
  assert.equal(out.by, 'jev');
  assert.deepEqual(
    out.days.map((d) => d.date),
    ['2030-01-10', '2030-01-11'],
  );
  assert.equal(claude.calls.length, 1, 'one Claude call, as before');
});

test('Jev unsure, off, failing or saying "nothing": Claude’s read and the word rules decide, as before', async () => {
  const cases = [
    [fakeFetch(answer('yesno', 0.6)), ENV],
    [fakeFetch(answer('none', 0.99)), ENV],
    [fakeFetch({}, { status: 500 }), ENV],
    [fakeFetch(answer('yesno', 0.99)), {}],
  ];
  for (const [jev, env] of cases) {
    const claude = claudeWith(read({ decide: 'what', question: 'Where should we eat?', choices: ['Rosa’s', 'Luigi’s'] }));
    const { out } = await quietly(() => ask('Rosa’s or Luigi’s for dinner', { jev, claude, env }));
    assert.equal(out.kind, 'vote');
    assert.equal(out.by, 'claude');
    assert.deepEqual(out.options, ['Rosa’s', 'Luigi’s']);
  }
  // Words that say which still count as the words' pick when Jev doesn't decide.
  const claude = claudeWith(read({ decide: 'what', question: 'Which book?', choices: ['Dune', 'Emma'] }));
  const out = await ask('Vote on our next book: Dune or Emma', { jev: fakeFetch(answer('vote', 0.5)), claude });
  assert.equal(out.by, 'words');
});

test('Jev sure it’s a date poll but Claude found no days: it defers rather than make up days', async () => {
  const claude = claudeWith(read({ decide: 'what', question: 'What theme?', choices: ['Disco', '80s'] }));
  const out = await ask('Party theme: disco or 80s', { jev: fakeFetch(answer('date', 0.9)), claude });
  assert.equal(out.kind, 'vote');
  assert.equal(out.by, 'claude');
});

// ---------- Answer for me: the calendar, then Jev, then Claude for what Jev isn't sure of ----------

import { answerForMe } from '../src/ai.js';
import { jevAnswers, MAX_ANSWER_OPTIONS } from '../src/jev.js';

const T0 = Date.UTC(2030, 0, 8, 15); // Tue
const HR = 3_600_000;
const optionsPoll = (n = 4) => ({
  title: 'Sync',
  timezone: 'UTC',
  mode: 'options',
  options: Array.from({ length: n }, (_, i) => ({ start: T0 + i * 24 * HR, end: T0 + i * 24 * HR + HR })),
});
/** Jev answering per time key: { t1: ['no', 0.95], ... }; keys left out aren't answered. */
const answersOf = (by) => ({
  answers: Object.fromEntries(
    Object.entries(by).map(([k, [choice, p]]) => [k, { type: 'choice', choice, confidence: p, probabilities: { [choice]: p } }]),
  ),
  usage: { cost: 0.00003 },
});

test('jevAnswers: one question per time, only the words, the time zone and the times are sent', async () => {
  const f = fakeFetch(answersOf({ t1: ['no', 0.9], t2: ['maybe', 0.9] }));
  const out = await jevAnswers(
    ENV,
    {
      preferences: 'No Tuesdays',
      timezone: 'Europe/London',
      options: [
        { key: 't1', label: 'Tue, Jan 8' },
        { key: 't2', label: 'Wed' },
      ],
    },
    { fetch: f },
  );
  assert.deepEqual(out, { answers: { t1: { answer: 'no', p: 0.9 } }, cost: 30 }); // an unknown choice is dropped
  const { body } = f.calls[0];
  assert.deepEqual(Object.keys(body.questions), ['t1', 't2']);
  assert.deepEqual(Object.keys(body.questions.t1.criteria), ['yes', 'if_needed', 'no']);
  assert.match(body.questions.t1.instructions, /Tue, Jan 8/);
  assert.equal(body.state, 'What they wrote: No Tuesdays\nTheir time zone: Europe/London');
  assert.deepEqual(body.provider, { data_collection: 'deny' });
  assert.equal(
    await jevAnswers({}, { preferences: 'x', timezone: 'UTC', options: [{ key: 't1', label: 'x' }] }, { fetch: f }),
    null,
  );
  assert.equal(await jevAnswers(ENV, { preferences: 'x', timezone: 'UTC', options: [] }, { fetch: f }), null);
});

test('Answer for me: Jev sure of every time, so Claude is never called; busy and tentative times follow the calendar', async () => {
  const ev = optionsPoll(4);
  // Time 1 busy (never sent to Jev), time 2 tentative, times 3 and 4 free.
  const busy = [
    { start: T0, end: T0 + HR },
    { start: T0 + 24 * HR, end: T0 + 25 * HR, tentative: true },
  ];
  const f = fakeFetch(answersOf({ t1: ['yes', 0.95], t2: ['no', 0.9], t3: ['if_needed', 0.85] }));
  const claude = claudeWith();
  const out = await answerForMe(
    ENV,
    ev,
    { preferences: 'Not Thursdays', busy, timezone: 'UTC' },
    { anthropic: claude.anthropic, fetch: f },
  );
  assert.equal(out.by, 'jev');
  assert.equal(claude.calls.length, 0);
  assert.deepEqual(out.answers, {
    [T0]: { answer: 0, note: 'Busy in your calendar' },
    [T0 + 24 * HR]: { answer: 1, note: 'Tentative in your calendar' }, // Jev said yes; a tentative event caps it
    [T0 + 48 * HR]: { answer: 0, note: '' },
    [T0 + 72 * HR]: { answer: 1, note: '' },
  });
  // Three questions, none for the busy time, and nothing from the calendar in what's sent.
  const { body } = f.calls[0];
  assert.equal(Object.keys(body.questions).length, 3);
  assert.doesNotMatch(JSON.stringify(body), /calendar|busy|tentative/i);
});

test('Answer for me: Claude answers only the times Jev isn’t sure about, numbered for itself', async () => {
  const ev = optionsPoll(3);
  const f = fakeFetch(answersOf({ t1: ['no', 0.95], t2: ['yes', 0.6] })); // t3 not answered
  const claude = claudeWith({
    answers: [
      { option: 1, answer: 'if_needed', note: 'Late for you' },
      { option: 2, answer: 'yes', note: '' },
    ],
  });
  const out = await answerForMe(
    ENV,
    ev,
    { preferences: 'Not Tuesdays', timezone: 'UTC' },
    { anthropic: claude.anthropic, fetch: f },
  );
  assert.equal(out.by, 'claude');
  assert.equal(claude.calls.length, 1);
  const prompt = claude.calls[0].messages[0].content;
  assert.match(prompt, /1\. Wed, Jan 9/);
  assert.match(prompt, /2\. Thu, Jan 10/);
  assert.doesNotMatch(prompt, /Jan 8/);
  assert.deepEqual(out.answers, {
    [T0]: { answer: 0, note: '' },
    [T0 + 24 * HR]: { answer: 1, note: 'Late for you' },
    [T0 + 48 * HR]: { answer: 2, note: '' },
  });
});

test('Answer for me: Jev off or failing sends every open time to Claude, as before; past the cap, Claude takes the rest', async () => {
  for (const [env, f] of [
    [{}, fakeFetch(answersOf({ t1: ['no', 0.99] }))],
    [ENV, fakeFetch({}, { status: 500 })],
  ]) {
    const claude = claudeWith({ answers: [1, 2].map((option) => ({ option, answer: 'yes', note: '' })) });
    const { out } = await quietly(() =>
      answerForMe(env, optionsPoll(2), { preferences: 'Any', timezone: 'UTC' }, { anthropic: claude.anthropic, fetch: f }),
    );
    assert.equal(out.by, 'claude');
    assert.equal(Object.keys(out.answers).length, 2);
    assert.match(claude.calls[0].messages[0].content, /2\. Wed, Jan 9/);
  }
  const n = MAX_ANSWER_OPTIONS + 2;
  const all = Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i + 1}`, ['yes', 0.99]]));
  const f = fakeFetch(answersOf(all));
  const claude = claudeWith({ answers: [1, 2].map((option) => ({ option, answer: 'no', note: '' })) });
  const out = await answerForMe(
    ENV,
    optionsPoll(n),
    { preferences: 'Any', timezone: 'UTC' },
    { anthropic: claude.anthropic, fetch: f },
  );
  assert.equal(Object.keys(f.calls[0].body.questions).length, MAX_ANSWER_OPTIONS);
  assert.equal(Object.values(out.answers).filter((a) => a.answer === 0).length, 2);
});

test('an open question with nothing named ("What should we make for dinner?"): a vote, with options Claude suggests', async () => {
  for (const jev of [fakeFetch(answer('vote', 0.95)), fakeFetch(answer('vote', 0.4))]) {
    const claude = claudeWith(read({ decide: 'what', question: 'What should we make for dinner?', choices: [] }), {
      question: 'What should we make?',
      yesNo: false,
      options: ['Pasta', 'Tacos', 'Curry'],
    });
    const out = await ask('What should we make for dinner?', { jev, claude });
    assert.equal(out.kind, 'vote');
    assert.equal(out.question, 'What should we make for dinner?'); // the read's wording stays
    assert.deepEqual(out.options, ['Pasta', 'Tacos', 'Curry']);
    assert.equal(out.suggested, true);
    assert.equal(claude.calls.length, 2);
  }
  // Named choices aren't "suggested", and when the writer can't suggest any, the vote stays empty.
  const named = await ask('Pizza or tacos?', {
    jev: fakeFetch(answer('vote', 0.95)),
    claude: claudeWith(read({ decide: 'what', question: 'Pizza or tacos?', choices: ['Pizza', 'Tacos'] })),
  });
  assert.equal(named.suggested, undefined);
  const { out: empty } = await quietly(() =>
    ask('Vote on our next book.', {
      jev: fakeFetch(answer('vote', 0.95)),
      claude: claudeWith(read({ decide: 'what', question: 'What should we read next?', choices: [] }), {
        question: 'Which?',
        yesNo: false,
        options: [],
      }),
    }),
  );
  assert.deepEqual(empty.options, []);
  assert.equal(empty.suggested, undefined);
});

test('the check counts whether a vote came with options (filled), so an empty one shows in the stats', async () => {
  const { claudeKind } = await import('../src/kind-check.js');
  const now = HOUR0;
  const run = (...outs) => claudeKind({}, 'What should we make for dinner?', { now, anthropic: claudeWith(...outs).anthropic });
  const q = read({ decide: 'what', question: 'What should we make for dinner?', choices: [] });
  assert.deepEqual(await run(q, { question: 'Q?', yesNo: false, options: ['A', 'B'] }), { got: 'vote', filled: 'yes' });
  assert.deepEqual(await run(q, { question: 'Q?', yesNo: false, options: [] }), { got: 'vote', filled: 'no' });
  assert.deepEqual(await run(q, { question: 'Q?', yesNo: true, options: [] }), { got: 'yesno' });
});

test('Answer for me: every time busy in the calendar is answered with no model at all, counted as the calendar', async () => {
  const ev = optionsPoll(2);
  const busy = [{ start: T0 - HR, end: T0 + 48 * HR }];
  const f = fakeFetch(answersOf({}));
  const claude = claudeWith();
  const out = await answerForMe(
    ENV,
    ev,
    { preferences: 'Any', busy, timezone: 'UTC' },
    { anthropic: claude.anthropic, fetch: f },
  );
  assert.equal(out.by, 'calendar');
  assert.equal(f.calls.length, 0);
  assert.equal(claude.calls.length, 0);
  assert.deepEqual(Object.values(out.answers), [
    { answer: 0, note: 'Busy in your calendar' },
    { answer: 0, note: 'Busy in your calendar' },
  ]);
});
