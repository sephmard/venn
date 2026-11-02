import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';
import { aiAllowance, aiBudget, allowanceKey, costOf, weekOf } from '../src/ai.js';
import { createStore, sqliteAdapter } from '../src/store.js';

// A stand-in for the Anthropic client: records each request and returns the next canned output.
const calls = [];
let nextOutput = {};
let nextStop = 'end_turn';
let nextUsage = { input_tokens: 1000, output_tokens: 200 };
const fakeAnthropic = {
  beta: {
    messages: {
      create: async (params) => {
        calls.push(params);
        return {
          stop_reason: nextStop,
          usage: nextUsage,
          content: [{ type: 'text', text: JSON.stringify(nextOutput) }],
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
  assert.deepEqual(res.data.days, [
    { date: '2030-01-10', part: 'evening' },
    { date: '2030-01-12', part: 'afternoon' },
  ]);
  nextOutput = {
    title: 'Call',
    answerWith: 'hours',
    days: [
      { date: '2030-01-10', part: '', from: '18:00', to: '20:15' },
      { date: '2030-01-11', part: '', from: '20:00', to: '19:00' }, // ends before it starts
    ],
  };
  const hours = await call('/api/ai/draft-days', { body: { prompt: 'call, Thursday 6 to 8', timezone: 'UTC' } });
  assert.deepEqual(hours.data.days, [{ date: '2030-01-10', start: 1080, end: 1230 }]);
  nextOutput = { title: 'x', answerWith: 'days', days: [{ date: 'soon', part: '', from: '', to: '' }] };
  assert.equal((await call('/api/ai/draft-days', { body: { prompt: 'whenever', timezone: 'UTC' } })).status, 503);
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
  };
  calls.length = 0;
  const res = await call('/api/ai/draft-template', {
    body: { prompt: 'A hiking club, outdoorsy and friendly', name: 'Peak Club' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, {
    look: { accent: '#2f6b3a', font: 'slab', bodyFont: 'humanist', corners: 'round', buttons: 'pill' },
    title: 'Trail day',
  });
  assert.match(calls[0].messages[0].content, /<user_text>Organization: Peak Club\nA hiking club/);
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
  // A request that fails before Claude answers gives its free request back.
  const bad = await fetch(`http://localhost:${port}/api/ai/draft-poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'lunch', timezone: 'Not/AZone' }),
  });
  assert.equal(bad.status, 400);
  assert.deepEqual([(await post()).status, (await post()).status], [200, 200]);
  const third = await post();
  assert.equal(third.status, 402);
  assert.match((await third.json()).error, /this week's free AI requests/);
  // A key of your own is never counted, and never needs the allowance.
  assert.equal((await post({ 'x-anthropic-key': `sk-ant-${'a'.repeat(30)}` })).status, 200);
  assert.equal((await post({ 'x-anthropic-key': 'not-a-key' })).status, 400);
  // Next week starts again.
  clock += 7 * 24 * 3_600_000;
  assert.equal((await post()).status, 200);
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
