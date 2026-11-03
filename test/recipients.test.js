// The per-poll cap on how many different people a poll emails in a day (src/recipients.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../src/api.js';
import { createStore, sqliteAdapter } from '../src/store.js';
import { POLL_RECIPIENTS_PER_DAY, mayEmail, recipientCap } from '../src/recipients.js';
import { YES } from '../public/core.js';

const DAY = 86_400_000;
const today = Date.UTC(2030, 0, 10, 12);

test('the cap: 100 by default, POLL_RECIPIENTS_PER_DAY changes it, 0 turns it off', () => {
  assert.equal(POLL_RECIPIENTS_PER_DAY, 100);
  assert.equal(recipientCap({}), 100);
  assert.equal(recipientCap({ POLL_RECIPIENTS_PER_DAY: '' }), 100);
  assert.equal(recipientCap({ POLL_RECIPIENTS_PER_DAY: '25' }), 25);
  assert.equal(recipientCap({ POLL_RECIPIENTS_PER_DAY: '0' }), 0);
  assert.equal(recipientCap({ POLL_RECIPIENTS_PER_DAY: 'lots' }), 100);
  assert.equal(recipientCap({ POLL_RECIPIENTS_PER_DAY: '-3' }), 100);
});

test('a poll emails at most the cap of different people a day; the same person again is free, and each poll and day counts alone', async () => {
  const db = new DatabaseSync(':memory:');
  const store = createStore(sqliteAdapter(db));
  const env = { POLL_RECIPIENTS_PER_DAY: '2' };
  assert.equal(await mayEmail(store, env, 'p1', 'ana@example.com', today), true);
  assert.equal(await mayEmail(store, env, 'p1', 'Ana@Example.com ', today), true); // the same person
  assert.equal(await mayEmail(store, env, 'p1', 'ben@example.com', today), true);
  assert.equal(await mayEmail(store, env, 'p1', 'cy@example.com', today), false); // a third: past the cap
  assert.equal(await mayEmail(store, env, 'p1', 'ana@example.com', today), true); // still counted
  assert.equal(await mayEmail(store, env, 'p2', 'cy@example.com', today), true); // another poll
  assert.equal(await mayEmail(store, env, 'p1', 'cy@example.com', today + DAY), true); // the next day
  assert.equal(await mayEmail(store, { POLL_RECIPIENTS_PER_DAY: '0' }, 'p1', 'dee@example.com', today), true);

  // Kept as hashes only, and cleared once they're two days old.
  const rows = db.prepare('SELECT * FROM email_recipients').all();
  assert.ok(rows.length >= 4);
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.recipient_hash) && !JSON.stringify(r).includes('@')));
  await mayEmail(store, env, 'p3', 'eve@example.com', today + 3 * DAY);
  const days = db
    .prepare('SELECT DISTINCT day FROM email_recipients ORDER BY day')
    .all()
    .map((r) => r.day);
  assert.deepEqual(days, ['2030-01-13']);
});

test('through the API: answer copies and the date email stop at the cap, the organizer is told nothing new and nothing breaks', async () => {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  const sent = [];
  const pending = [];
  const env = {
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'Venn <notify@venn.example>',
    EMAIL_SIGNIN: 'off',
    POLL_RECIPIENTS_PER_DAY: '2',
  };
  const fetchImpl = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await handleApi(
      new Request(`https://venn.day${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body && JSON.stringify(body),
      }),
      store,
      { env, fetchImpl, waitUntil: (p) => pending.push(p), clientIp: '127.0.0.1' },
    );
    const data = await res.json();
    await Promise.all(pending.splice(0));
    return { status: res.status, data };
  };
  const to = () => sent.filter((s) => s.url.endsWith('/emails')).map((s) => s.body.to[0]);
  const slot = Date.UTC(2030, 0, 10, 19);
  const { data } = await call('/api/events', {
    method: 'POST',
    body: {
      title: 'Book club',
      timezone: 'UTC',
      mode: 'options',
      options: [{ start: slot, end: slot + 3_600_000 }],
      requireEmail: true,
    },
  });
  for (const name of ['ana', 'ben', 'cy']) {
    const r = await call(`/api/events/${data.id}/participants`, {
      method: 'POST',
      body: { name, email: `${name}@example.com`, copyTo: `${name}@example.com`, availability: { [slot]: YES } },
    });
    assert.equal(r.status, 201); // the answer is saved either way
  }
  assert.deepEqual(to(), ['ana@example.com', 'ben@example.com']);
  sent.length = 0;
  const fin = await call(`/api/events/${data.id}/finalize`, {
    method: 'POST',
    body: { start: slot },
    headers: { 'x-admin-token': data.adminToken },
  });
  assert.equal(fin.status, 200);
  // The date goes to the two already counted today, not to a third.
  assert.deepEqual(to().sort(), ['ana@example.com', 'ben@example.com']);
});
