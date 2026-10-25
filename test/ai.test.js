import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

// A stand-in for the Anthropic client: records each request and returns the next canned output.
const calls = [];
let nextOutput = {};
let nextStop = 'end_turn';
const fakeAnthropic = {
  beta: {
    messages: {
      create: async (params) => {
        calls.push(params);
        return { stop_reason: nextStop, content: [{ type: 'text', text: JSON.stringify(nextOutput) }] };
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
  assert.equal(params.model, 'claude-opus-5-5');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
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
