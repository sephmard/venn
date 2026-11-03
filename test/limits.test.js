import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowWrite, writeWindows } from '../src/limits.js';
import { handleApi } from '../src/api.js';
import { createStore, sqliteAdapter } from '../src/store.js';
import { DatabaseSync } from 'node:sqlite';

const MIN = 60_000;

test('30 new polls per ten minutes per address, then a rest', async () => {
  const w = writeWindows();
  for (let i = 0; i < 30; i++) assert.equal(await allowWrite({}, 'create', '1.2.3.4', 1000 + i, w), true);
  assert.equal(await allowWrite({}, 'create', '1.2.3.4', 2000, w), false);
  // Someone else, and answers, count separately.
  assert.equal(await allowWrite({}, 'create', '5.6.7.8', 2000, w), true);
  assert.equal(await allowWrite({}, 'answer', '1.2.3.4', 2000, w), true);
  // Ten minutes after the first ones, there's room again.
  assert.equal(await allowWrite({}, 'create', '1.2.3.4', 1000 + 10 * MIN, w), true);
});

test('200 answers per ten minutes (a big poll on one office network), and the server can change or turn off each limit', async () => {
  const w = writeWindows();
  for (let i = 0; i < 200; i++) assert.equal(await allowWrite({}, 'answer', 'a', i, w), true);
  assert.equal(await allowWrite({}, 'answer', 'a', 201, w), false);
  const two = writeWindows();
  const env = { CREATE_RATE_LIMIT: '2' };
  assert.equal(await allowWrite(env, 'create', 'a', 0, two), true);
  assert.equal(await allowWrite(env, 'create', 'a', 1, two), true);
  assert.equal(await allowWrite(env, 'create', 'a', 2, two), false);
  const off = writeWindows();
  for (let i = 0; i < 100; i++) assert.equal(await allowWrite({ ANSWER_RATE_LIMIT: '0' }, 'answer', 'a', i, off), true);
  // A setting that isn't a number keeps the default rather than switching the limit off.
  const bad = writeWindows();
  for (let i = 0; i < 30; i++) await allowWrite({ CREATE_RATE_LIMIT: 'lots' }, 'create', 'a', i, bad);
  assert.equal(await allowWrite({ CREATE_RATE_LIMIT: 'lots' }, 'create', 'a', 31, bad), false);
});

test("Cloudflare's rate limiting binding is used when there is one", async () => {
  const keys = [];
  const env = { WRITE_RATE_LIMITER: { limit: async ({ key }) => (keys.push(key), { success: keys.length < 2 }) } };
  assert.equal(await allowWrite(env, 'create', '1.2.3.4', 0, writeWindows()), true);
  assert.equal(await allowWrite(env, 'answer', '', 0, writeWindows()), false);
  assert.deepEqual(keys, ['create:1.2.3.4', 'answer:unknown']);
});

test('the memory kept for the limits stays bounded', async () => {
  const w = writeWindows();
  for (let i = 0; i < 10_001; i++) await allowWrite({}, 'create', `ip${i}`, 0, w);
  assert.ok(w.size <= 10_000);
});

test('the API answers 429 once an address makes too many polls or answers', async () => {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  const env = { CREATE_RATE_LIMIT: '1', ANSWER_RATE_LIMIT: '1' };
  const opts = { env, clientIp: '9.9.9.9', writeWindows: writeWindows() };
  const post = (path, body) =>
    handleApi(
      new Request(`http://x${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      store,
      opts,
    );
  const poll = {
    title: 'Dinner',
    timezone: 'Europe/London',
    dates: ['2030-01-02'],
    startMinute: 600,
    endMinute: 720,
    slotMinutes: 30,
    durationMinutes: 60,
  };
  const first = await post('/api/events', poll);
  assert.equal(first.status, 201);
  const { id } = await first.json();
  const second = await post('/api/events', poll);
  assert.equal(second.status, 429);
  assert.match((await second.json()).error, /going a bit fast/);
  assert.equal((await post('/api/brands', { name: 'Acme' })).status, 429);
  const answer = { name: 'Sam', availability: {} };
  assert.notEqual((await post(`/api/events/${id}/participants`, answer)).status, 429);
  assert.equal((await post(`/api/events/${id}/participants`, { ...answer, name: 'Kim' })).status, 429);
});

const apiPost =
  (store, opts) =>
  (path, body, headers = {}) =>
    handleApi(
      new Request(`http://x${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(body),
      }),
      store,
      opts,
    );
const newStore = () => createStore(sqliteAdapter(new DatabaseSync(':memory:')));
const dinner = {
  title: 'Dinner',
  timezone: 'Europe/London',
  dates: ['2030-01-02'],
  startMinute: 600,
  endMinute: 720,
  slotMinutes: 30,
  durationMinutes: 60,
};

test("polls made through /api/mcp share their own, higher limit: Claude's servers call for everyone", async () => {
  const post = apiPost(newStore(), { env: { MCP_RATE_LIMIT: '40' }, clientIp: '1.1.1.1', writeWindows: writeWindows() });
  const make = async (n) => {
    const res = await post('/api/mcp', {
      jsonrpc: '2.0',
      id: n,
      method: 'tools/call',
      params: { name: 'create_venn', arguments: { title: `Call ${n}`, timezone: 'UTC', days: ['2030-01-10'] } },
    });
    return (await res.json()).result;
  };
  // More than the 30 one visitor may make directly.
  for (let i = 0; i < 40; i++) assert.equal((await make(i)).isError, undefined, `poll ${i}`);
  const over = await make(41);
  assert.equal(over.isError, true);
  assert.match(over.content[0].text, /going a bit fast/);
  // A visitor at the same address still has their own 30.
  assert.equal((await post('/api/events', dinner)).status, 201);
});

test('an app with a key (APP_KEYS) makes polls and templates for its users without the per-address limit', async () => {
  const env = { CREATE_RATE_LIMIT: '1', APP_KEYS: 'key-for-club-app' };
  const post = apiPost(newStore(), { env, clientIp: '2.2.2.2', writeWindows: writeWindows() });
  const app = { authorization: 'Bearer key-for-club-app' };
  for (let i = 0; i < 3; i++) assert.equal((await post('/api/events', dinner, app)).status, 201);
  assert.equal((await post('/api/brands', { name: 'Club' }, app)).status, 201);
  assert.equal((await post('/api/events', dinner)).status, 201);
  assert.equal((await post('/api/events', dinner)).status, 429);
  // A wrong key is just another visitor.
  assert.equal((await post('/api/events', dinner, { authorization: 'Bearer nope' })).status, 429);
});

test('usage counts from one browser past the limit are dropped quietly', async () => {
  const counted = [];
  const store = { countUsage: async (day, name) => counted.push(name) };
  const env = { STATS_TOKEN: 't', USAGE_RATE_LIMIT: '2' };
  const post = apiPost(store, { env, clientIp: '3.3.3.3', writeWindows: writeWindows() });
  const share = { name: 'share', props: { how: 'copy', from: 'poll' } };
  for (let i = 0; i < 4; i++) assert.equal((await post('/api/usage', share)).status, 204);
  assert.deepEqual(counted, ['share', 'share']);
  // Without usage stats on, nothing is counted and the limit isn't touched.
  const off = writeWindows();
  await apiPost(store, { env: {}, clientIp: '3.3.3.3', writeWindows: off })('/api/usage', share);
  assert.equal(off.size, 0);
});
