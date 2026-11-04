import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../server.js';
import { aiAllowance, aiBudget, allowanceKey, costOf, weekOf } from '../src/ai.js';
import { createStore, sqliteAdapter } from '../src/store.js';
import { handleApi } from '../src/api.js';
import { writeWindows } from '../src/limits.js';

// A stand-in for the Anthropic client: records each request and returns the next canned output.
const calls = [];
let nextOutput = {};
let nextStop = 'end_turn';
let nextUsage = { input_tokens: 1000, output_tokens: 200 };
let nextError = null;
const fakeAnthropic = {
  beta: {
    messages: {
      create: async (params) => {
        calls.push(params);
        if (nextError) {
          const e = nextError;
          nextError = null;
          throw e;
        }
        return {
          stop_reason: nextStop,
          usage: nextUsage,
          // A list answers one call each, in turn (an endpoint that asks twice).
          content: [{ type: 'text', text: JSON.stringify(Array.isArray(nextOutput) ? nextOutput.shift() : nextOutput) }],
        };
      },
    },
  },
};

let server, base;
before(async () => {
  server = createApp({ env: { ANTHROPIC_API_KEY: 'sk-test', AI_RATE_LIMIT: '1000' }, anthropic: fakeAnthropic });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'POST', body = {}, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

const H = 3_600_000;
const t0 = Date.UTC(2030, 0, 8, 15); // Tue 8 Jan 2030, 10:00 in New York
const poll = {
  title: 'Design review',
  timezone: 'America/New_York',
  mode: 'options',
  options: [0, 24, 48].map((h) => ({ start: t0 + h * H, end: t0 + (h + 1) * H })),
};

test('AI is reported and every request uses the expected model settings', async () => {
  assert.equal((await call('/api/config', { method: 'GET' })).data.ai, true);
  nextOutput = { title: 'Design review', description: '', durationMinutes: 45, slots: [{ date: '2030-01-09', time: '14:00' }] };
  calls.length = 0;
  await call('/api/ai/draft-poll', {
    body: { prompt: '45 min design review, Wednesday afternoon', timezone: 'America/New_York' },
  });
  const params = calls[0];
  // Haiku by default, which has no server-side fallback.
  assert.equal(params.model, 'claude-haiku-5-5');
  assert.equal(params.betas, undefined);
  assert.equal(params.fallbacks, undefined);
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.equal(params.output_config.format.schema.additionalProperties, false);
  assert.match(params.messages[0].content, /<user_text>45 min design review, Wednesday afternoon<\/user_text>/);
});

test('describe it in words: draft times are converted to the organizer’s time zone and checked', async () => {
  nextOutput = {
    title: 'Design review',
    description: 'Walk through onboarding.',
    durationMinutes: 45,
    slots: [
      { date: '2030-01-09', time: '14:00' },
      { date: '2030-01-09', time: '14:00' }, // duplicate
      { date: '2020-01-01', time: '10:00' }, // in the past
      { date: 'soon', time: '10:00' }, // nonsense
      { date: '2030-01-10', time: '09:30' },
    ],
  };
  const { status, data } = await call('/api/ai/draft-poll', { body: { prompt: 'design review', timezone: 'America/New_York' } });
  assert.equal(status, 200);
  assert.equal(data.durationMinutes, 45);
  assert.deepEqual(
    data.options.map((o) => new Date(o.start).toISOString()),
    ['2030-01-09T19:00:00.000Z', '2030-01-10T14:30:00.000Z'],
  );
  assert.equal(data.options[0].end - data.options[0].start, 45 * 60_000);
  // The drafted poll is valid input for creating a poll.
  assert.equal((await call('/api/events', { body: { ...data, timezone: 'America/New_York', mode: 'options' } })).status, 201);

  assert.equal((await call('/api/ai/draft-poll', { body: { prompt: '', timezone: 'America/New_York' } })).status, 400);
  assert.equal(
    (await call('/api/ai/draft-poll', { body: { prompt: 'x'.repeat(700), timezone: 'America/New_York' } })).status,
    400,
  );
});

test('smart recommendation is organizer-only and points at a real option', async () => {
  const { id, adminToken } = (await call('/api/events', { body: poll })).data;
  await call(`/api/events/${id}/participants`, { body: { name: 'Ana', availability: { [t0 + 24 * H]: 2 } } });
  await call(`/api/events/${id}/participants`, { body: { name: 'Lee', availability: { [t0 + 24 * H]: 1, [t0]: 2 } } });

  assert.equal((await call(`/api/events/${id}/ai/summary`)).status, 403);
  nextOutput = { summary: 'Wednesday works for both.', recommendedOption: 2, reason: 'Everyone can make it.' };
  calls.length = 0;
  const { data } = await call(`/api/events/${id}/ai/summary`, { headers: { 'x-admin-token': adminToken } });
  assert.deepEqual(data, {
    summary: 'Wednesday works for both.',
    recommendedStart: t0 + 24 * H,
    reason: 'Everyone can make it.',
  });
  assert.match(calls[0].messages[0].content, /2\. Wed, Jan 9, 10:00 AM–11:00 AM EST — Ana: yes; Lee: if needed/);
});

test('answer for me uses calendar conflicts and preferences', async () => {
  const { id } = (await call('/api/events', { body: poll })).data;
  nextOutput = {
    answers: [
      { option: 1, answer: 'no', note: 'Busy in your calendar' },
      { option: 2, answer: 'if_needed', note: 'Morning' },
      { option: 3, answer: 'yes', note: '' },
      { option: 9, answer: 'yes', note: 'not a real option' },
    ],
  };
  calls.length = 0;
  const { status, data } = await call(`/api/events/${id}/ai/answer`, {
    body: { preferences: 'Mornings are hard', busy: [{ start: t0, end: t0 + H }], timezone: 'Europe/London' },
  });
  assert.equal(status, 200);
  assert.deepEqual(data.answers, {
    [t0]: { answer: 0, note: 'Busy in your calendar' },
    [t0 + 24 * H]: { answer: 1, note: 'Morning' },
    [t0 + 48 * H]: { answer: 2, note: '' },
  });
  const prompt = calls[0].messages[0].content;
  assert.match(prompt, /1\. Tue, Jan 8, 3:00 PM–4:00 PM GMT \[calendar: busy\]/);
  assert.match(prompt, /2\. .*\[calendar: free\]/);
  assert.equal((await call(`/api/events/${id}/ai/answer`, { body: { preferences: '' } })).status, 400);
});

test('write the messages', async () => {
  const { id, adminToken } = (await call('/api/events', { body: poll })).data;
  const admin = { 'x-admin-token': adminToken };
  nextOutput = { message: 'Hi all! Pick your times here.' };
  calls.length = 0;
  const invite = await call(`/api/events/${id}/ai/message`, { body: { kind: 'invite' }, headers: admin });
  assert.equal(invite.data.message, 'Hi all! Pick your times here.');
  assert.match(calls[0].messages[0].content, new RegExp(`Link: http://localhost:\\d+/e/${id}`));
  assert.equal((await call(`/api/events/${id}/ai/message`, { body: { kind: 'announcement' }, headers: admin })).status, 400);
  assert.equal((await call(`/api/events/${id}/ai/message`, { body: { kind: 'spam' }, headers: admin })).status, 400);
  assert.equal((await call(`/api/events/${id}/ai/message`, { body: { kind: 'invite' } })).status, 403);
});

test('refusals become a friendly error', async () => {
  nextStop = 'refusal';
  const res = await call('/api/ai/draft-poll', { body: { prompt: 'something', timezone: 'UTC' } });
  nextStop = 'end_turn';
  assert.equal(res.status, 503);
  assert.match(res.data.error, /couldn't help/);
});

test('when Anthropic turns the server key down, the log says why, without any key', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const headers = new Headers({ 'request-id': 'req_123' });
  const body = (type, message) => ({ type: 'error', error: { type, message } });
  const post = () => call('/api/ai/draft-poll', { body: { prompt: 'dinner friday', timezone: 'UTC' } });

  nextError = new Anthropic.BadRequestError(
    400,
    body('invalid_request_error', 'Your credit balance is too low. sk-ant-api03-abcdefghijklmnopqrstuvwxyz'),
    undefined,
    headers,
  );
  let res = await post();
  assert.equal(res.status, 503);
  assert.match(res.data.error, /couldn't respond/);
  const line = logged.find((l) => l.startsWith('AI request failed'));
  assert.ok(line, 'the failure is logged');
  const info = JSON.parse(line.slice('AI request failed '.length));
  assert.equal(info.key, 'server');
  assert.equal(info.reason, 'bad-request');
  assert.equal(info.status, 400);
  assert.equal(info.type, 'invalid_request_error');
  assert.equal(info.requestId, 'req_123');
  assert.match(info.message, /credit balance is too low/);
  assert.doesNotMatch(line, /abcdefghij/); // anything like a key is taken out

  // A server key Anthropic rejects: people see the usual message, the log says "auth".
  logged.length = 0;
  nextError = new Anthropic.AuthenticationError(401, body('authentication_error', 'invalid x-api-key'), undefined, headers);
  res = await post();
  assert.equal(res.status, 503);
  assert.match(res.data.error, /couldn't respond/);
  assert.match(logged.join('\n'), /"reason":"auth"/);

  // A refusal isn't Anthropic failing: nothing is logged for it.
  logged.length = 0;
  nextStop = 'refusal';
  await post();
  nextStop = 'end_turn';
  assert.equal(logged.filter((l) => l.startsWith('AI request failed')).length, 0);
});

test('AI is off without a key, and rate limited per visitor', async (t) => {
  const off = createApp({ env: {} });
  const limited = createApp({ env: { ANTHROPIC_API_KEY: 'sk-test', AI_RATE_LIMIT: '2' }, anthropic: fakeAnthropic });
  await Promise.all([off, limited].map((s) => new Promise((r) => s.listen(0, r))));
  t.after(() => [off, limited].forEach((s) => s.close()));
  const post = (s, path) =>
    fetch(`http://localhost:${s.address().port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'lunch', timezone: 'UTC' }),
    });
  assert.equal((await post(off, '/api/ai/draft-poll')).status, 404);
  nextOutput = { title: 'Lunch', description: '', durationMinutes: 60, slots: [{ date: '2030-01-09', time: '12:00' }] };
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await post(limited, '/api/ai/draft-poll')).status);
  assert.deepEqual(statuses, [200, 200, 429]);
});

test('other models keep the refusal fallback', async (t) => {
  const s = createApp({ env: { ANTHROPIC_API_KEY: 'sk-test', AI_MODEL: 'claude-sonnet-5-5' }, anthropic: fakeAnthropic });
  await new Promise((r) => s.listen(0, r));
  t.after(() => s.close());
  nextOutput = { title: 'Lunch', description: '', durationMinutes: 60, slots: [{ date: '2030-01-09', time: '12:00' }] };
  calls.length = 0;
  await fetch(`http://localhost:${s.address().port}/api/ai/draft-poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'lunch', timezone: 'UTC' }),
  });
  assert.equal(calls[0].model, 'claude-sonnet-5-5');
  assert.deepEqual(calls[0].betas, ['server-side-fallback-2026-07-01']);
  assert.equal(calls[0].fallbacks, 'default');
});

test('describe it on /new: days, parts of the day or hours, checked', async () => {
  nextOutput = {
    title: 'Book club',
    emoji: '📚 books',
    tile: 'dusk',
    location: '  Ana’s place  ',
    answerWith: 'parts',
    days: [
      { date: '2030-01-10', part: 'evening', from: '', to: '' },
      { date: '2030-01-10', part: 'evening', from: '', to: '' }, // twice
      { date: '2030-01-11', part: 'night', from: '', to: '' }, // not a part of the day
      { date: '2020-01-11', part: 'evening', from: '', to: '' }, // past
      { date: '2030-01-12', part: 'afternoon', from: '', to: '' },
    ],
  };
  const res = await call('/api/ai/draft-days', {
    body: { prompt: 'book club, Thursday evening or Saturday afternoon', timezone: 'UTC' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.level, 'parts');
  // The rest of the poll, checked: one emoji, the place as named, a short title.
  assert.equal(res.data.emoji, '📚');
  assert.equal(res.data.tile, 'dusk'); // a style Venn draws
  assert.equal(res.data.location, 'Ana’s place');
  assert.equal(res.data.title, 'Book club');
  assert.deepEqual(res.data.days, [
    { date: '2030-01-10', part: 'evening' },
    { date: '2030-01-12', part: 'afternoon' },
  ]);
  nextOutput = {
    title: 'A call about everything we need to plan for the trip, the food, the cars and who sleeps where',
    emoji: 'phone',
    tile: '<svg onload=alert(1)>',
    location: '',
    answerWith: 'hours',
    days: [
      { date: '2030-01-10', part: '', from: '18:00', to: '20:15' },
      { date: '2030-01-11', part: '', from: '20:00', to: '19:00' }, // ends before it starts
    ],
  };
  const hours = await call('/api/ai/draft-days', { body: { prompt: 'call, Thursday 6 to 8', timezone: 'UTC' } });
  assert.deepEqual(hours.data.days, [{ date: '2030-01-10', start: 1080, end: 1230 }]);
  assert.equal(hours.data.emoji, ''); // not an emoji: the plan's own
  assert.equal(hours.data.tile, ''); // not one of Venn's styles: the plain tile
  assert.equal(hours.data.title.length, 80);
  assert.equal(hours.data.location, '');
  nextOutput = { title: 'x', answerWith: 'days', days: [{ date: 'soon', part: '', from: '', to: '' }] };
  assert.equal((await call('/api/ai/draft-days', { body: { prompt: 'whenever', timezone: 'UTC' } })).status, 503);
});

test('describe the days: only the span the person gave, and optional days marked if needed', async () => {
  nextOutput = {
    title: 'Dinner',
    answerWith: 'days',
    firstDate: '2030-01-07',
    lastDate: '2030-01-13', // "this week"
    days: [
      { date: '2030-01-10', part: '', from: '', to: '', ifNeeded: false },
      { date: '2030-01-12', part: '', from: '', to: '', ifNeeded: true }, // "Saturday if needed"
      { date: '2030-01-17', part: '', from: '', to: '', ifNeeded: false }, // past the span it read
    ],
  };
  calls.length = 0;
  const res = await call('/api/ai/draft-days', {
    body: { prompt: 'dinner this week, Thursday, Saturday only if needed', timezone: 'UTC' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.days, [{ date: '2030-01-10' }, { date: '2030-01-12', ifNeeded: true }]);
  // The calendar it's given says which days are this week and next.
  const sent = calls.at(-1).messages[0].content;
  assert.match(sent, /^This week:$/m);
  assert.match(sent, /^Next week:\n {2}Monday \d{4}-\d{2}-\d{2}$/m);
});

test('describe your organization: a template look, only known fonts and readable colours', async () => {
  nextOutput = {
    accent: '#2F6B3A',
    ownPage: true,
    bg: '#f3f1e8',
    surface: '#fbfaf5',
    text: 'black', // not a colour code: the page keeps Venn's
    font: 'slab',
    bodyFont: 'humanist',
    corners: 'round',
    buttons: 'pill',
    title: 'Trail day',
    name: '  Peak Hiking Club ',
    emoji: '🥾 boots',
  };
  calls.length = 0;
  const res = await call('/api/ai/draft-template', {
    body: { prompt: 'A hiking club, outdoorsy and friendly', name: 'Peak Club' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, {
    look: { accent: '#2f6b3a', font: 'slab', bodyFont: 'humanist', corners: 'round', buttons: 'pill' },
    title: 'Trail day',
    name: 'Peak Hiking Club',
    emoji: '🥾',
  });
  assert.match(calls[0].messages[0].content, /<user_text>Organization: Peak Club\nA hiking club/);
});

test('describe a vote: a question and its options, tidied; or one yes-or-no question', async () => {
  nextOutput = {
    question: 'Where should we eat Friday?',
    yesNo: false,
    options: [' Rosa’s ', 'Luigi’s', 'rosa’s', '', 'Thai place'],
  };
  const res = await call('/api/ai/draft-topic', { body: { prompt: 'Friday dinner: Rosa’s, Luigi’s or the Thai place' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, {
    question: 'Where should we eat Friday?',
    yesNo: false,
    options: ['Rosa’s', 'Luigi’s', 'Thai place'],
  });
  nextOutput = { question: 'Should we do a book swap?', yesNo: true, options: ['Yes', 'No'] };
  assert.deepEqual((await call('/api/ai/draft-topic', { body: { prompt: 'book swap or not' } })).data, {
    question: 'Should we do a book swap?',
    yesNo: true,
    options: [],
  });
  nextOutput = { question: 'Which?', yesNo: false, options: ['Only one'] };
  assert.equal((await call('/api/ai/draft-topic', { body: { prompt: 'hmm' } })).status, 503);
});

test('one Use AI box: Venn picks a date poll or a vote (ask-kind.js), from one answer where it can', async () => {
  const day = (date) => ({ date, parts: [], from: '', to: '', ifNeeded: false });
  const ask = (prompt) => call('/api/ai/draft', { body: { prompt, timezone: 'UTC' } });
  // A time to find: the date poll's draft, as draft-days gives it, from one call.
  nextOutput = { title: 'Dinner', timeOfDay: 'any', decide: 'when', days: [day('2030-01-10')] };
  calls.length = 0;
  const date = await ask('dinner next week');
  assert.equal(date.status, 200);
  assert.equal(date.data.kind, 'date');
  assert.equal(date.data.why, 'open');
  assert.deepEqual(date.data.days, [{ date: '2030-01-10' }]);
  assert.equal(calls.length, 1);
  // Choosing between named things: a vote from the same answer, with no second call.
  nextOutput = {
    title: 'Dinner',
    timeOfDay: 'any',
    decide: 'what',
    question: '',
    choices: ['Italian', 'Thai', 'Mexican'],
    days: [],
  };
  calls.length = 0;
  const vote = await ask('Italian, Thai or Mexican?');
  assert.deepEqual(vote.data, {
    kind: 'vote',
    why: 'open',
    question: 'Italian, Thai or Mexican?',
    yesNo: false,
    options: ['Italian', 'Thai', 'Mexican'],
    note: '',
    date: null,
  });
  assert.equal(calls.length, 1);
  // Choices on a day that's set: a vote, the day in its note, and the days kept for "Make it a date poll instead".
  nextOutput = {
    title: 'Dinner',
    timeOfDay: 'any',
    decide: 'both',
    question: 'Pizza or tacos?',
    choices: ['Pizza', 'Tacos'],
    days: [day('2030-01-11')],
  };
  const both = await ask('pizza or tacos on Friday?');
  assert.equal(both.data.kind, 'vote');
  assert.equal(both.data.why, 'both');
  assert.equal(both.data.question, 'Pizza or tacos?');
  assert.equal(both.data.note, 'Friday, Jan 11');
  assert.deepEqual(both.data.date.days, [{ date: '2030-01-11' }]);
  assert.equal(both.data.date.vote, undefined);
  // The words win over the model: "a vote on…" is a vote, written by the vote writer when nothing was named.
  nextOutput = [
    { title: 'Book club', timeOfDay: 'any', decide: 'when', days: [day('2030-01-10')] },
    { question: 'Which book next?', yesNo: false, options: ['Dune', 'Emma'] },
  ];
  calls.length = 0;
  const words = await ask('a vote on our next book');
  assert.equal(words.data.kind, 'vote');
  assert.equal(words.data.why, 'words');
  assert.deepEqual(words.data.options, ['Dune', 'Emma']);
  assert.equal(calls.length, 2);
  for (const c of calls) assert.match(c.messages[0].content, /<user_text>a vote on our next book<\/user_text>/);
  // …and "find a date…" is a date poll, though the model read choices.
  nextOutput = {
    title: 'Book club',
    timeOfDay: 'any',
    decide: 'what',
    question: '',
    choices: ['a', 'b', 'c'],
    days: [day('2030-01-12')],
  };
  const found = await ask('find a date for book club: a, b or c?');
  assert.equal(found.data.kind, 'date');
  assert.equal(found.data.why, 'words');
  // A question with no time in it and nothing named to pick from: a vote, never "no days". The vote
  // writer says it's yes or no, whether the days model read the question (what) or not (when).
  for (const first of [
    { title: 'Cute?', timeOfDay: 'any', decide: 'when', days: [] },
    { title: 'Cute?', timeOfDay: 'any', decide: 'what', question: 'Do you think I’m cute?', choices: [], days: [] },
  ]) {
    nextOutput = [first, { question: 'Do you think I’m cute?', yesNo: true, options: [] }];
    calls.length = 0;
    const cute = await ask('I want to ask my wife if she thinks I’m cute');
    assert.equal(cute.status, 200, JSON.stringify(cute.data));
    assert.equal(cute.data.kind, 'vote');
    assert.equal(cute.data.why, first.decide === 'when' ? 'question' : 'open');
    assert.equal(cute.data.yesNo, true);
    assert.equal(cute.data.question, 'Do you think I’m cute?');
    assert.deepEqual(cute.data.options, []);
    assert.equal(cute.data.date, null);
    assert.equal(calls.length, 2);
  }
  // An open question with no time: a vote with the options the vote writer suggests.
  nextOutput = [
    { title: 'Dog', timeOfDay: 'any', decide: 'when', days: [] },
    { question: 'Which dog should we get?', yesNo: false, options: ['Lab', 'Beagle', 'Poodle'] },
  ];
  const dog = await ask('what kind of dog should we get');
  assert.equal(dog.data.kind, 'vote');
  assert.equal(dog.data.why, 'question');
  assert.deepEqual(dog.data.options, ['Lab', 'Beagle', 'Poodle']);
  // A question the vote writer can't make anything of: said, and no kind.
  nextOutput = [
    { title: '', timeOfDay: 'any', decide: 'when', days: [] },
    { question: '', yesNo: false, options: [] },
  ];
  const none = await ask('should we?');
  assert.equal(none.status, 503);
  assert.match(none.data.error, /Couldn't tell what to set up/);
  // A plan with no time that isn't a question still asks for when, with no made-up options.
  for (const plan of ['Book club with Sam', 'hmm']) {
    nextOutput = { title: 'Book club', timeOfDay: 'any', decide: 'when', days: [] };
    calls.length = 0;
    const r = await ask(plan);
    assert.equal(r.status, 503, plan);
    assert.match(r.data.error, /Couldn't find any days/);
    assert.equal(calls.length, 1, plan);
  }
  // Asked when, but no time read: still the date poll's message.
  nextOutput = { title: '', timeOfDay: 'any', decide: 'when', days: [] };
  const when = await ask('when can we meet');
  assert.equal(when.status, 503);
  assert.match(when.data.error, /Couldn't find any days/);
  assert.equal((await call('/api/ai/draft', { body: { prompt: 'x', timezone: 'Mars/Base' } })).status, 400);
});

test('one Use AI box: one allowance a press, given back on failure, and words without it', async (t) => {
  const s = createApp({ env: { ANTHROPIC_API_KEY: 'sk-test', AI_WEEKLY_LIMIT: '1' }, anthropic: fakeAnthropic });
  await new Promise((r) => s.listen(0, r));
  t.after(() => s.close());
  const port = s.address().port;
  const ask = (prompt, headers = {}) =>
    fetch(`http://localhost:${port}/api/ai/draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ prompt, timezone: 'UTC' }),
    }).then(async (r) => ({ status: r.status, data: await r.json() }));
  const allowance = async () => (await fetch(`http://localhost:${port}/api/ai/allowance`)).json();
  // A failed answer gives its unit back.
  nextError = new Anthropic.APIConnectionError({ message: 'down' });
  assert.notEqual((await ask('a vote on films')).status, 200);
  assert.deepEqual(await allowance(), { allowance: 'available' });
  // A press that lands on a vote takes one unit, though the model is asked twice.
  nextOutput = [
    { title: 'Films', timeOfDay: 'any', decide: 'when', days: [] },
    { question: 'Which film?', yesNo: false, options: ['Heat', 'Up'] },
  ];
  calls.length = 0;
  assert.equal((await ask('a vote on films')).status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(await allowance(), { allowance: 'used' });
  // Used up, no key: days are read from the words, a plain choice is split, and nothing reaches Anthropic.
  calls.length = 0;
  const days = await ask('Fridays next month');
  assert.equal(days.status, 200);
  assert.equal(days.data.kind, 'date');
  assert.equal(days.data.why, 'words');
  assert.ok(days.data.days.length >= 4);
  const split = await ask('Italian, Thai or Mexican?');
  assert.deepEqual(split.data, {
    kind: 'vote',
    why: 'open',
    yesNo: false,
    note: '',
    date: null,
    question: 'Italian, Thai or Mexican?',
    options: ['Italian', 'Thai', 'Mexican'],
  });
  assert.equal((await ask('a vote on films')).status, 402); // the key form opens
  assert.equal(calls.length, 0);
  // Your own key still works, and isn't counted.
  nextOutput = {
    title: 'Lunch',
    timeOfDay: 'any',
    decide: 'when',
    days: [{ date: '2030-01-10', parts: [], from: '', to: '', ifNeeded: false }],
  };
  assert.equal((await ask('lunch', { 'x-anthropic-key': `sk-ant-${'a'.repeat(30)}` })).status, 200);
});

test('one Use AI box with no AI on the server: days and plain choices from the words', async (t) => {
  const s = createApp({ env: {} });
  await new Promise((r) => s.listen(0, r));
  t.after(() => s.close());
  const ask = (prompt) =>
    fetch(`http://localhost:${s.address().port}/api/ai/draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, timezone: 'UTC' }),
    }).then(async (r) => ({ status: r.status, data: await r.json() }));
  assert.equal((await ask('evenings this week')).data.kind, 'date');
  assert.deepEqual((await ask('pizza or tacos?')).data.options, ['Pizza', 'Tacos']);
  const vote = await ask('a vote on our next book');
  assert.equal(vote.status, 400);
  assert.equal(vote.data.error, 'Without AI, Venn can read days but not choices. Type the options below.');
});

test('the server key has a weekly allowance; past it, people bring their own key', async (t) => {
  let clock = Date.UTC(2030, 0, 8, 12); // a Tuesday
  const s = createApp({
    env: { ANTHROPIC_API_KEY: 'sk-test', AI_WEEKLY_LIMIT: '2' },
    anthropic: fakeAnthropic,
    now: () => clock,
  });
  await new Promise((r) => s.listen(0, r));
  t.after(() => s.close());
  const port = s.address().port;
  const post = (headers = {}) =>
    fetch(`http://localhost:${port}/api/ai/draft-poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ prompt: 'lunch', timezone: 'UTC' }),
    });
  nextOutput = { title: 'Lunch', description: '', durationMinutes: 60, slots: [{ date: '2030-02-09', time: '12:00' }] };
  const config = await (await fetch(`http://localhost:${port}/api/config`)).json();
  assert.equal(config.aiWeekly, 2);
  // Whether this visitor's free requests are there, before asking: never a count, and asking takes none.
  const allowance = async () => {
    const res = await fetch(`http://localhost:${port}/api/ai/allowance`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    return res.json();
  };
  for (let i = 0; i < 3; i++) assert.deepEqual(await allowance(), { allowance: 'available' });
  // A request that fails before Claude answers gives its free request back.
  const bad = await fetch(`http://localhost:${port}/api/ai/draft-poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'lunch', timezone: 'Not/AZone' }),
  });
  assert.equal(bad.status, 400);
  // So does one for a poll that isn't there.
  const missing = await fetch(`http://localhost:${port}/api/events/nope1234/ai/summary`, { method: 'POST' });
  assert.equal(missing.status, 404);
  assert.deepEqual([(await post()).status, (await post()).status], [200, 200]);
  assert.deepEqual(await allowance(), { allowance: 'used' });
  const third = await post();
  assert.equal(third.status, 402);
  assert.match((await third.json()).error, /this week's free AI requests/);
  // A key of your own is never counted, and never needs the allowance.
  assert.equal((await post({ 'x-anthropic-key': `sk-ant-${'a'.repeat(30)}` })).status, 200);
  assert.equal((await post({ 'x-anthropic-key': 'not-a-key' })).status, 400);
  // Next week starts again.
  clock += 7 * 24 * 3_600_000;
  assert.deepEqual(await allowance(), { allowance: 'available' });
  assert.equal((await post()).status, 200);
});

test('the allowance reads "off" where the server key pays for nothing, and "used" past the dollar cap', async () => {
  const get = async (env, before) => {
    const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
    await before?.(store);
    const res = await handleApi(new Request('http://x/api/ai/allowance'), store, {
      env,
      clientIp: '1.2.3.4',
      now: () => Date.UTC(2030, 0, 8, 12),
    });
    return res.json();
  };
  assert.deepEqual(await get({}), { allowance: 'off' }); // no AI on this server
  assert.deepEqual(await get({ ANTHROPIC_API_KEY: 'k', AI_WEEKLY_BUDGET_USD: '0' }), { allowance: 'off' });
  assert.deepEqual(await get({ ANTHROPIC_API_KEY: 'k', AI_WEEKLY_LIMIT: '0' }), { allowance: 'off' });
  // The week's spend at the cap: used for everyone, without saying it was the dollars.
  const week = weekOf(Date.UTC(2030, 0, 8, 12));
  assert.deepEqual(
    await get({ ANTHROPIC_API_KEY: 'k', AI_WEEKLY_BUDGET_USD: '1' }, (store) => store.addAiSpend(week, 1_000_000)),
    { allowance: 'used' },
  );
  // Asking is cheap but still limited per address (a database read anyone could loop on).
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  const opts = {
    env: { ANTHROPIC_API_KEY: 'k', AI_ALLOWANCE_RATE_LIMIT: '2' },
    clientIp: '5.5.5.5',
    writeWindows: writeWindows(),
  };
  const ask = () => handleApi(new Request('http://x/api/ai/allowance'), store, opts);
  assert.deepEqual([(await ask()).status, (await ask()).status], [200, 200]);
  const third = await ask();
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) > 0);
  // Everyone's share used up, this visitor's own not: used too.
  assert.deepEqual(
    await get({ ANTHROPIC_API_KEY: 'k', AI_WEEKLY_TOTAL: '1' }, (store) => store.takeAiAllowance(week, 'someone-else', 20, 1)),
    { allowance: 'used' },
  );
});

test('a weekly dollar cap on the server key, worked out from each answer’s tokens', async (t) => {
  // Haiku: $0.10 in and $0.50 out per million tokens, so 1M in + 1M out is 600,000 millionths.
  assert.equal(costOf('claude-haiku-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 600_000);
  assert.equal(costOf('claude-sonnet-5-5', { input_tokens: 1e6 }), 2_000_000);
  assert.equal(costOf('some-new-model', { output_tokens: 1e6 }), 20_000_000); // unknown: priced as Opus
  assert.equal(aiBudget({}), 5_000_000); // $5 a week unless set
  assert.equal(aiBudget({ AI_WEEKLY_BUDGET_USD: '0.5' }), 500_000);
  assert.deepEqual(aiAllowance({ ANTHROPIC_API_KEY: 'k', AI_WEEKLY_BUDGET_USD: '0' }), { perPerson: 0, total: 0, budget: 0 });

  const s = createApp({
    env: { ANTHROPIC_API_KEY: 'sk-test', AI_WEEKLY_BUDGET_USD: '1', AI_MODEL: 'claude-haiku-5-5' },
    anthropic: fakeAnthropic,
    now: () => Date.UTC(2030, 0, 8, 12),
  });
  await new Promise((r) => s.listen(0, r));
  t.after(() => {
    s.close();
    nextUsage = { input_tokens: 1000, output_tokens: 200 };
  });
  const post = (headers = {}) =>
    fetch(`http://localhost:${s.address().port}/api/ai/draft-poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ prompt: 'lunch', timezone: 'UTC' }),
    });
  nextOutput = { title: 'Lunch', description: '', durationMinutes: 60, slots: [{ date: '2030-02-09', time: '12:00' }] };
  nextUsage = { input_tokens: 1e6, output_tokens: 1e6 }; // $0.60 each
  assert.deepEqual([(await post()).status, (await post()).status], [200, 200]); // $1.20 spent: over $1
  const over = await post();
  assert.equal(over.status, 402);
  assert.match((await over.json()).error, /used up for this week/);
  // A key of your own still works, and isn't counted.
  assert.equal((await post({ 'x-anthropic-key': `sk-ant-${'c'.repeat(30)}` })).status, 200);
});

test('with only AI_OWN_KEYS on, AI needs a key of your own', async (t) => {
  const seen = [];
  const s = createApp({ env: { AI_OWN_KEYS: 'on' }, anthropic: fakeAnthropic });
  await new Promise((r) => s.listen(0, r));
  t.after(() => s.close());
  const port = s.address().port;
  const config = await (await fetch(`http://localhost:${port}/api/config`)).json();
  assert.deepEqual([config.ai, config.aiWeekly], [true, 0]);
  const post = (headers = {}) =>
    fetch(`http://localhost:${port}/api/ai/draft-poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ prompt: 'lunch', timezone: 'UTC' }),
    });
  const res = await post();
  seen.push(res.status);
  assert.equal(res.status, 402);
  assert.match((await res.json()).error, /Add your own Anthropic API key/);
  assert.equal((await post({ 'x-anthropic-key': `sk-ant-${'b'.repeat(30)}` })).status, 200);
});

test('the weekly allowance: per person and for everyone, hashed, and last week is cleared', async () => {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  assert.equal(weekOf(Date.UTC(2030, 0, 8, 12)), '2030-01-07'); // Tuesday → Monday
  assert.equal(weekOf(Date.UTC(2030, 0, 13, 23)), '2030-01-07'); // Sunday → the Monday before
  const [a, b] = [await allowanceKey('2030-01-07', null, '198.51.100.1'), await allowanceKey('2030-01-07', 'u1', '198.51.100.1')];
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.notEqual(a, await allowanceKey('2030-01-14', null, '198.51.100.1')); // a new week, a new hash
  const take = (who) => store.takeAiAllowance('2030-01-07', who, 2, 3);
  assert.deepEqual([await take(a), await take(a), await take(a)], [null, null, 'person']);
  assert.deepEqual([await take(b), await take(b)], [null, 'total']);
  assert.equal(await store.takeAiAllowance('2030-01-14', a, 2, 3), null);
  assert.equal(await store.takeAiAllowance('2030-01-07', b, 2, 3), null); // last week's counts are gone
  await store.returnAiAllowance('2030-01-07', b); // a failed request gives it back
  assert.deepEqual([await take(b), await take(b), await take(b)], [null, null, 'person']);
});
