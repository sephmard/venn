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

test('60 answers per ten minutes, and the server can change or turn off each limit', async () => {
  const w = writeWindows();
  for (let i = 0; i < 60; i++) assert.equal(await allowWrite({}, 'answer', 'a', i, w), true);
  assert.equal(await allowWrite({}, 'answer', 'a', 61, w), false);
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
