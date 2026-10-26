import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { cleanUsage, pollKind, sizeOf } from '../src/usage.js';
import { IF_NEEDED, YES } from '../public/core.js';

const TOKEN = 'stats-secret';
let server, baseUrl;

before(async () => {
  server = createApp({ env: { STATS_TOKEN: TOKEN } });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
// Counts are saved after the response.
const settle = () => server.settled();
const stats = () => call('/api/stats?days=7', { headers: { authorization: `Bearer ${TOKEN}` } });
const total = (counts, name, match = {}) =>
  counts
    .filter((c) => c.name === name && Object.entries(match).every(([k, v]) => c.props[k] === v))
    .reduce((a, c) => a + c.count, 0);

test('only known events with known values are counted', () => {
  assert.deepEqual(cleanUsage('view', { page: 'poll', as: 'guest' }, { client: true }), {
    name: 'view',
    props: '{"as":"guest","page":"poll"}',
  });
  assert.equal(cleanUsage('view', { page: 'poll', poll: 'abc123' }, { client: true }), null); // unknown property
  assert.equal(cleanUsage('view', { page: 'secret-page' }, { client: true }), null); // unknown value
  assert.equal(cleanUsage('nope', {}, { client: true }), null);
  assert.equal(cleanUsage('poll.created', {}, { client: true }), null); // the browser can't fake server events
  assert.equal(cleanUsage('view', { page: 'poll' }), null);
  assert.equal(cleanUsage('toString', {}, { client: true }), null);
  // Where someone who goes on to make a poll came from: answering one, or a picked date.
  assert.deepEqual(cleanUsage('view', { page: 'chooser', from: 'guest' }, { client: true }), {
    name: 'view',
    props: '{"from":"guest","page":"chooser"}',
  });
  assert.equal(cleanUsage('view', { page: 'chooser', from: 'somewhere' }, { client: true }), null);
  // The "It's set" picture, shared from the share sheet or downloaded.
  assert.deepEqual(cleanUsage('share', { from: 'card', how: 'download' }, { client: true }), {
    name: 'share',
    props: '{"from":"card","how":"download"}',
  });
  assert.equal(cleanUsage('share', { from: 'card', how: 'print' }, { client: true }), null);
  // A Finn sticker, shared or saved.
  assert.deepEqual(cleanUsage('share', { from: 'sticker', how: 'sheet' }, { client: true }), {
    name: 'share',
    props: '{"from":"sticker","how":"sheet"}',
  });
  assert.equal(cleanUsage('share', { from: 'stickers', how: 'sheet' }, { client: true }), null);
});

test('polls are sorted into kinds', () => {
  const tz = 'UTC';
  const day = (d) => Date.UTC(2030, 0, d);
  assert.deepEqual(pollKind({ mode: 'options', timezone: tz, options: [{ start: day(1) + 3.6e6, end: day(1) + 7.2e6 }] }), {
    kind: 'pick',
    detail: 'times',
  });
  assert.equal(pollKind({ mode: 'options', timezone: tz, options: [{ start: day(1), end: day(2) }] }).detail, 'allday');
  assert.equal(pollKind({ mode: 'options', timezone: tz, options: [{ start: day(1), end: day(4) }] }).detail, 'trips');
  assert.equal(pollKind({ mode: 'options', layout: 'parts', timezone: tz, options: [] }).detail, 'parts');
  assert.deepEqual(pollKind({ dates: ['2030-01-01'], slotMinutes: 1440 }), { kind: 'free', detail: 'days' });
  assert.equal(pollKind({ windows: [], slotMinutes: 30 }).detail, 'hours');
  assert.equal(sizeOf({ windows: [{ date: 'a' }, { date: 'a' }, { date: 'b' }] }), '2-3');
});

test('counts what happens, and works out what happened to each poll', async () => {
  const H = 3_600_000;
  const t = Date.UTC(2030, 0, 8, 18);
  const options = [
    { start: t, end: t + 2 * H },
    { start: t + 24 * H, end: t + 26 * H },
  ];
  const created = await call('/api/events', {
    method: 'POST',
    body: {
      title: 'Dinner',
      emoji: '🍝',
      timezone: 'UTC',
      mode: 'options',
      options,
      hostAnswers: true,
      hostAvailability: { [t]: YES, [t + 24 * H]: IF_NEEDED },
    },
  });
  const { id, adminToken } = created.data;
  await call('/api/events', {
    method: 'POST',
    body: {
      title: 'Trip',
      timezone: 'UTC',
      dates: ['2030-01-08'],
      startMinute: 0,
      endMinute: 1440,
      slotMinutes: 1440,
      durationMinutes: 1440,
    },
  });
  await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Ann', availability: { [t]: YES } } });
  await call(`/api/events/${id}/finalize`, { method: 'POST', body: { start: t }, headers: { 'x-admin-token': adminToken } });
  assert.equal((await call('/api/usage', { method: 'POST', body: { name: 'view', props: { page: 'pick' } } })).status, 204);
  // Unknown events are dropped, and browsers that ask not to be tracked aren't counted.
  await call('/api/usage', { method: 'POST', body: { name: 'view', props: { page: 'pick', who: 'Ann' } } });
  await call('/api/usage', { method: 'POST', body: { name: 'view', props: { page: 'pick' } }, headers: { 'sec-gpc': '1' } });
  await settle();

  assert.equal((await call('/api/stats')).status, 403);
  assert.equal((await call('/api/stats', { headers: { authorization: 'Bearer wrong' } })).status, 403);
  const { status, data } = await stats();
  assert.equal(status, 200);
  assert.equal(total(data.counts, 'poll.created'), 2);
  assert.equal(
    total(data.counts, 'poll.created', {
      kind: 'pick',
      detail: 'times',
      plan: 'dinner',
      options: '2-3',
      email: 'no',
    }),
    1,
  );
  assert.equal(total(data.counts, 'poll.created', { kind: 'free', detail: 'days', plan: 'other' }), 1);
  assert.equal(total(data.counts, 'answer.created', { kind: 'pick' }), 1);
  assert.equal(total(data.counts, 'poll.finalized'), 1);
  assert.equal(total(data.counts, 'view', { page: 'pick' }), 1);
  // Nothing identifying is kept: no poll IDs, names or titles.
  const raw = JSON.stringify(data.counts);
  for (const secret of [id, 'Ann', 'Dinner', adminToken]) assert.ok(!raw.includes(secret), secret);

  // Outcomes come from the polls themselves; the organizer's own answer doesn't count as a guest.
  assert.deepEqual(data.outcomes.pick, {
    polls: 1,
    hostAnswered: 1,
    answered: 1,
    finalized: 1,
    medianGuests: 1,
    guests: { 1: 1 },
  });
  assert.deepEqual(data.outcomes.free, {
    polls: 1,
    hostAnswered: 0,
    answered: 0,
    finalized: 0,
    medianGuests: 0,
    guests: { 0: 1 },
  });
  assert.equal(data.outcomes.all.polls, 2);
  assert.equal(data.outcomes['pick/times'].polls, 1);
});

test('without STATS_TOKEN nothing is counted and there are no stats', async () => {
  const off = createApp({ env: {} });
  await new Promise((r) => off.listen(0, r));
  const url = `http://localhost:${off.address().port}`;
  try {
    assert.equal((await (await fetch(`${url}/api/config`)).json()).usage, false);
    assert.equal((await fetch(`${url}/api/stats`, { headers: { authorization: 'Bearer ' } })).status, 404);
    const res = await fetch(`${url}/api/usage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'view', props: { page: 'pick' } }),
    });
    assert.equal(res.status, 204);
  } finally {
    off.close();
  }
  assert.equal((await call('/api/config')).data.usage, true);
});
