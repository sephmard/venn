// Results counted on the server (GET /api/events/:id?results=1, src/results.js): the same counts
// and leaders the MCP server's get_venn_results gives, which ranks as the poll page does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { IF_NEEDED, YES } from '../public/core.js';

let server, base;
before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
async function poll(body, answers) {
  const { data } = await call('/api/events', { method: 'POST', body: { title: 'Plans', timezone: 'Europe/London', ...body } });
  for (const [name, availability] of answers)
    assert.equal(
      (await call(`/api/events/${data.id}/participants`, { method: 'POST', body: { name, availability } })).status,
      201,
    );
  return data;
}
const results = async (id, headers) => (await call(`/api/events/${id}?results=1`, { headers })).data.results;
async function mcp(id) {
  const { data } = await call('/api/mcp', {
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_venn_results', arguments: { poll: id } } },
  });
  return JSON.parse(data.result.content[0].text);
}

test('a vote: counts per option, every option tied for the lead, and the same as MCP says', async () => {
  const { id } = await poll({ mode: 'topic', options: ['Italian', 'Thai', 'Mexican'] }, [
    ['Ana', { 1: YES, 3: IF_NEEDED }],
    ['Bo', { 1: YES, 2: YES }],
    ['Cy', { 2: YES }],
  ]);
  const r = await results(id);
  assert.deepEqual(r, {
    respondents: 3,
    options: [
      { id: 1, yes: 2, ifNeeded: 0 },
      { id: 2, yes: 2, ifNeeded: 0 },
      { id: 3, yes: 0, ifNeeded: 1 },
    ],
    leaders: [1, 2],
  });
  const m = await mcp(id);
  const labels = { 1: 'Italian', 2: 'Thai', 3: 'Mexican' };
  assert.deepEqual(
    m.leading,
    r.leaders.map((l) => labels[l]),
  );
  assert.deepEqual(
    m.options.map((o) => [o.option, o.yes, o.ifNeeded]),
    r.options.map((o) => [labels[o.id], o.yes, o.ifNeeded]),
  );
  // No results field unless asked for.
  assert.equal((await call(`/api/events/${id}`)).data.results, undefined);
});

test('a vote nobody said yes to has no leader; more yeses beat if needed', async () => {
  const none = await poll({ mode: 'topic', options: ['A', 'B'] }, [['Ana', {}]]);
  assert.deepEqual((await results(none.id)).leaders, []);
  const { id } = await poll({ mode: 'topic', options: ['A', 'B'] }, [
    ['Ana', { 1: IF_NEEDED, 2: YES }],
    ['Bo', { 1: YES, 2: IF_NEEDED }],
    ['Cy', { 2: YES }],
  ]);
  assert.deepEqual((await results(id)).leaders, [2]);
});

const H = 3_600_000;
const t = [0, 1, 2].map((d) => Date.UTC(2030, 0, 8 + d, 18));

test('specific times: counts per time, the ranked best, ties, and the same as MCP says', async () => {
  const { id } = await poll({ mode: 'options', options: t.map((start) => ({ start, end: start + 2 * H })) }, [
    ['Ana', { [t[0]]: YES, [t[1]]: YES }],
    ['Bo', { [t[0]]: YES, [t[1]]: YES, [t[2]]: IF_NEEDED }],
  ]);
  const r = await results(id);
  assert.equal(r.respondents, 2);
  assert.deepEqual(r.slots, [
    { start: t[0], yes: 2, ifNeeded: 0 },
    { start: t[1], yes: 2, ifNeeded: 0 },
    { start: t[2], yes: 0, ifNeeded: 1 },
  ]);
  assert.deepEqual(r.leaders, [
    { start: t[0], end: t[0] + 2 * H },
    { start: t[1], end: t[1] + 2 * H },
  ]);
  const m = await mcp(id);
  assert.equal(m.leading.length, 2);
  assert.match(m.summary, /^Tied/);
  assert.deepEqual(
    m.best.map((b) => [Date.parse(b.start), Date.parse(b.end), b.available, b.ifNeeded]),
    r.best.map((b) => [b.start, b.end, b.yes, b.ifNeeded]),
  );
});

test('a trip (days in a row): one leader, as the stretches overlap; nobody answered: none', async () => {
  const body = {
    dates: ['2030-01-10', '2030-01-11', '2030-01-12'],
    startMinute: 0,
    endMinute: 1440,
    slotMinutes: 1440,
    durationMinutes: 2880,
  };
  const empty = await poll(body, []);
  assert.deepEqual(await results(empty.id), {
    respondents: 0,
    slots: (await call(`/api/events/${empty.id}`)).data.slots.map((start) => ({ start, yes: 0, ifNeeded: 0 })),
    best: [],
    leaders: [],
  });
  const { id } = await poll(body, []);
  const slots = (await call(`/api/events/${id}`)).data.slots;
  const all = Object.fromEntries(slots.map((s) => [s, YES]));
  await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Ana', availability: all } });
  const r = await results(id);
  assert.equal(r.leaders.length, 1);
  assert.equal(r.leaders[0].end - r.leaders[0].start, 2 * 24 * H);
  const m = await mcp(id);
  assert.equal(Date.parse(m.best[0].start), r.leaders[0].start);
});

test('hidden answers: guests get no results, the organizer does; hidden names never show in them', async () => {
  const { id, adminToken } = await poll({ mode: 'topic', options: ['A', 'B'] }, [['Ana Secret', { 1: YES }]]);
  const admin = { 'x-admin-token': adminToken };
  await call(`/api/events/${id}/settings`, { method: 'PUT', body: { hideNames: true }, headers: admin });
  const named = await call(`/api/events/${id}?results=1`);
  assert.doesNotMatch(JSON.stringify(named.data.results), /Ana/);
  await call(`/api/events/${id}/settings`, { method: 'PUT', body: { hideResults: true }, headers: admin });
  const guest = (await call(`/api/events/${id}?results=1`)).data;
  assert.equal(guest.results, undefined);
  assert.equal(guest.responses, 1);
  assert.deepEqual((await results(id, admin)).leaders, [1]);
});

test('asking for results has its own per-address limit, with Retry-After; plain reads and app keys are not held to it', async () => {
  const limited = createApp({ dbPath: ':memory:', env: { RESULTS_RATE_LIMIT: '2', APP_KEYS: 'key-for-club-app' } });
  await new Promise((r) => limited.listen(0, r));
  try {
    const at = `http://localhost:${limited.address().port}`;
    const make = await fetch(`${at}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Plans', timezone: 'UTC', mode: 'topic', options: ['A', 'B'] }),
    });
    const { id } = await make.json();
    const get = (q = '?results=1', headers = {}) => fetch(`${at}/api/events/${id}${q}`, { headers });
    assert.equal((await get()).status, 200);
    assert.equal((await get()).status, 200);
    const over = await get();
    assert.equal(over.status, 429);
    const wait = Number(over.headers.get('retry-after'));
    assert.ok(wait > 590 && wait <= 600, `Retry-After ${wait}`);
    assert.equal(over.headers.get('ratelimit-limit'), '2');
    // The poll itself still loads, and an app with a key still gets results.
    assert.equal((await get('')).status, 200);
    const app = await get('?results=1', { authorization: 'Bearer key-for-club-app' });
    assert.equal(app.status, 200);
    assert.ok((await app.json()).results);
  } finally {
    limited.close();
  }
});
