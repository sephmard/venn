// The per-poll cap on how many different people a poll emails in a day (src/recipients.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../src/api.js';
import { createStore, sqliteAdapter } from '../src/store.js';
import {
  EMAIL_DAILY_LIMIT,
  POLL_RECIPIENTS_PER_DAY,
  dailyLimit,
  mayEmail,
  recipientCap,
  recipientHash,
  withinDailyLimit,
} from '../src/recipients.js';
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

test('invitations and reminders past the cap: left unsent, not counted as reminded, and Remind now says why', async () => {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  const sent = [];
  const pending = [];
  const clock = Date.UTC(2026, 10, 1, 12);
  const env = {
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'Venn <notify@venn.example>',
    EMAIL_SIGNIN: 'off',
    POLL_RECIPIENTS_PER_DAY: '1',
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
      { env, fetchImpl, now: () => clock, waitUntil: (p) => pending.push(p), clientIp: '127.0.0.1' },
    );
    const data = await res.json();
    await Promise.all(pending.splice(0));
    return { status: res.status, data };
  };
  const to = () => sent.filter((s) => s.url.endsWith('/emails')).map((s) => s.body.to[0]);
  const slot = Date.UTC(2026, 10, 10, 23);
  const make = async (invitees) => {
    const { status, data } = await call('/api/events', {
      method: 'POST',
      body: {
        title: 'Book club',
        timezone: 'UTC',
        mode: 'options',
        options: [{ start: slot, end: slot + 3_600_000 }],
        requireEmail: true,
        hostAvailability: {},
        deadline: clock + 4 * DAY,
        remindEvery: 1,
        invitees,
      },
    });
    assert.equal(status, 201, JSON.stringify(data));
    return { id: data.id, admin: { 'x-admin-token': data.adminToken } };
  };
  const view = async (p) => (await call(`/api/events/${p.id}/deadline`, { headers: p.admin })).data.invitees;

  // Invitations: the first goes out; the rest wait, not marked invited.
  const one = await make(['ana@example.com', 'lee@example.com']);
  assert.deepEqual(to(), ['ana@example.com']);
  assert.deepEqual(
    (await view(one)).map((i) => [i.email, i.invited]),
    [
      ['ana@example.com', true],
      ['lee@example.com', false],
    ],
  );

  // A reminder round: Ana (already emailed today) gets one; Lee, past the cap, isn't counted as reminded.
  sent.length = 0;
  assert.deepEqual((await call(`/api/events/${one.id}/remind`, { method: 'POST', headers: one.admin })).data, { sent: 1 });
  assert.deepEqual(to(), ['ana@example.com']);
  assert.deepEqual(
    (await view(one)).map((i) => i.reminded),
    [1, 0],
  );

  // When the cap is the only reason nothing went out, Remind now says so.
  const two = await make(['kim@example.com', 'max@example.com']);
  await call(`/api/events/${two.id}/participants`, {
    method: 'POST',
    body: { name: 'Kim', email: 'kim@example.com', availability: { [slot]: YES } },
  });
  const capped = await call(`/api/events/${two.id}/remind`, { method: 'POST', headers: two.admin });
  assert.equal(capped.status, 400);
  assert.match(capped.data.error, /emailed 1 different people today, its limit for a day/);
});

test('with EMAIL_HASH_SECRET the stored hash is an HMAC: not the plain SHA-256, and different per secret', async () => {
  const plain = await recipientHash('p1', 'ana@example.com');
  const a = await recipientHash('p1', 'Ana@Example.com ', { EMAIL_HASH_SECRET: 'one' });
  const b = await recipientHash('p1', 'ana@example.com', { EMAIL_HASH_SECRET: 'two' });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, plain);
  assert.notEqual(a, b);
  assert.equal(a, await recipientHash('p1', 'ana@example.com', { EMAIL_HASH_SECRET: 'one' }));

  const db = new DatabaseSync(':memory:');
  const store = createStore(sqliteAdapter(db));
  await mayEmail(store, { EMAIL_HASH_SECRET: 'one' }, 'p1', 'ana@example.com', today);
  assert.equal(db.prepare('SELECT recipient_hash FROM email_recipients').get().recipient_hash, a);
});

test('the daily ceiling: 1,000 by default; guests stop at 80%, the rest stays for account and organizer emails', async () => {
  assert.equal(EMAIL_DAILY_LIMIT, 1000);
  assert.equal(dailyLimit({}), 1000);
  assert.equal(dailyLimit({ EMAIL_DAILY_LIMIT: '50' }), 50);
  assert.equal(dailyLimit({ EMAIL_DAILY_LIMIT: '0' }), 0);
  assert.equal(dailyLimit({ EMAIL_DAILY_LIMIT: 'x' }), 1000);

  const db = new DatabaseSync(':memory:');
  const store = createStore(sqliteAdapter(db));
  const env = { EMAIL_DAILY_LIMIT: '10', POLL_RECIPIENTS_PER_DAY: '0' };
  const guest = [];
  for (let i = 0; i < 12; i++) guest.push(await mayEmail(store, env, `p${i}`, `g${i}@example.com`, today));
  assert.deepEqual(
    guest.map((x) => (x ? 1 : 0)),
    [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
  ); // 8 of 10, and the refused ones don't eat into the rest
  assert.equal(await withinDailyLimit(store, env, {}, today), true);
  assert.equal(await withinDailyLimit(store, env, {}, today), true);
  assert.equal(await withinDailyLimit(store, env, {}, today), false); // 10 sent
  assert.equal(await mayEmail(store, env, 'p1', 'g1@example.com', today + DAY), true); // a new day
  assert.equal(await withinDailyLimit(store, { EMAIL_DAILY_LIMIT: '0' }, {}, today), true);
  // Only counts, and only from yesterday on.
  await withinDailyLimit(store, env, {}, today + 3 * DAY);
  assert.deepEqual(
    db
      .prepare('SELECT day, sent FROM email_daily ORDER BY day')
      .all()
      .map((r) => ({ ...r })),
    [{ day: '2030-01-13', sent: 1 }],
  );
});

test('past the ceiling, an email sign-in still answers "check your inbox" but sends nothing', async () => {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  const sent = [];
  const pending = [];
  const env = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Venn <n@venn.example>', EMAIL_DAILY_LIMIT: '1' };
  const fetchImpl = async (url, init) => (sent.push(JSON.parse(init.body)), new Response('{}'));
  const ask = (email) =>
    handleApi(
      new Request('http://localhost/api/auth/email/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ email, password: 'correct horse battery staple' }),
      }),
      store,
      { env, fetchImpl, waitUntil: (p) => pending.push(p), now: () => today },
    );
  assert.equal((await ask('one@example.com')).status, 200);
  await Promise.all(pending);
  assert.equal(sent.length, 1); // the day's one email
  const res = await ask('two@example.com');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  await Promise.all(pending);
  assert.equal(sent.length, 1);
});
