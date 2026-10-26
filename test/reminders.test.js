import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';
import { createStore, d1Adapter, sqliteAdapter } from '../src/store.js';
import { REMINDER_WINDOW_MS, planNextUrl, sendReminders } from '../src/reminders.js';
import { reminderEmail } from '../src/notify.js';
import worker from '../src/worker.js';

const H = 3_600_000;
const DAY = 24 * H;
// Tue Oct 13 2026, 7pm in New York: the 2nd Tuesday.
const T = Date.UTC(2026, 9, 13, 23);
const poll = {
  title: 'Book club',
  emoji: '📚',
  organizer: 'Sam',
  timezone: 'America/New_York',
  mode: 'options',
  options: [
    { start: T, end: T + 2 * H },
    { start: T + DAY, end: T + DAY + 2 * H },
  ],
};

let server, base, sent;
const env = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Venn <notify@venn.example>' };

before(async () => {
  // Never a real email: the email service is this fake.
  const fakeFetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  server = createApp({ env, fetchImpl: fakeFetch });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => (sent = []));

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  await server.settled();
  return { status: res.status, data };
}

/** A poll with its date set (`start`, one of its two options), as the organizer made it. */
async function setPoll(extra = {}, start = T) {
  const options = [
    { start, end: start + 2 * H },
    { start: start + DAY, end: start + DAY + 2 * H },
  ];
  const { data } = await call('/api/events', { method: 'POST', body: { ...poll, options, ...extra } });
  await call(`/api/events/${data.id}/finalize`, {
    method: 'POST',
    body: { start },
    headers: { 'x-admin-token': data.adminToken },
  });
  return data;
}

test('the reminder email: "time to plan next month’s…?", with the link to the next one and a way to stop them', () => {
  const msg = reminderEmail({
    title: 'Book <club>',
    next: 'next month’s',
    planUrl: 'https://venn.example/new/pick?copy=abc&next=monthly',
    pollUrl: 'https://venn.example/e/abc',
    unsubscribeUrl: 'https://venn.example/e/abc#unsubscribe=u',
  });
  assert.equal(msg.subject, 'Time to plan next month’s Book <club>?');
  assert.match(msg.text, /Finn hopes it was a good one/);
  assert.ok(msg.text.includes('Plan next month’s: https://venn.example/new/pick?copy=abc&next=monthly\n'));
  assert.ok(msg.text.includes('Stop these emails: https://venn.example/e/abc#unsubscribe=u'));
  assert.match(msg.html, /Book &lt;club&gt;/);
  assert.doesNotMatch(msg.html, /<club>/);
  assert.match(msg.html, /href="https:\/\/venn\.example\/new\/pick\?copy=abc&amp;next=monthly"/);
  assert.match(msg.html, /Planned with Venn/);
  // Polls asking when people are available are planned again on their own create page.
  assert.equal(
    planNextUrl('https://v.example', { id: 'x', repeat: 'weekly', dates: [], slotMinutes: 1440 }),
    'https://v.example/new/free?copy=x&next=weekly',
  );
  assert.equal(
    planNextUrl('https://v.example', { id: 'x', repeat: 'monthly', mode: 'options', layout: 'parts' }),
    'https://v.example/new/free?copy=x&next=monthly',
  );
});

test('once the date of a plan that repeats has passed, its organizer gets one email to plan the next one', async () => {
  const { id } = await setPoll({ repeat: 'monthly', notifyEmail: 'sam@example.com' });
  sent = [];
  // Not while it's still on.
  assert.equal(await server.reminders(T + H), 0);
  assert.equal(sent.length, 0);
  assert.equal(await server.reminders(T + 3 * H), 1);
  assert.equal(sent.length, 1);
  const mail = sent[0].body;
  assert.deepEqual(mail.to, ['sam@example.com']);
  assert.equal(mail.subject, 'Time to plan next month’s Book club?');
  assert.ok(mail.text.includes(`${base}/new/pick?copy=${id}&next=monthly`));
  assert.match(mail.headers['List-Unsubscribe'], new RegExp(`^<${base}/e/${id}#unsubscribe=\\w+>$`));
  // Only once.
  assert.equal(await server.reminders(T + 4 * H), 0);
  assert.equal(await server.reminders(T + 2 * DAY), 0);
  assert.equal(sent.length, 1);
});

test('no reminder without a repeat, an email, or once the next one is planned; none weeks late', async () => {
  const later = T + 30 * DAY; // a date of its own, so other tests' polls aren't due
  await setPoll({ notifyEmail: 'sam@example.com' }, later);
  await setPoll({ repeat: 'weekly' }, later);
  const stopped = await setPoll({ repeat: 'weekly', notifyEmail: 'sam@example.com' }, later);
  const settings = (await call(`/api/events/${stopped.id}/notifications`, { headers: { 'x-admin-token': stopped.adminToken } }))
    .data;
  assert.equal(settings.email, 'sam@example.com');
  await call(`/api/events/${stopped.id}/notifications`, {
    method: 'PUT',
    body: { email: '' },
    headers: { 'x-admin-token': stopped.adminToken },
  });
  // The next one, planned from the last: no need to remind.
  const planned = await setPoll({ repeat: 'monthly', notifyEmail: 'sam@example.com' }, later);
  const nextOne = await call('/api/events', { method: 'POST', body: { ...poll, repeat: 'monthly', seriesOf: planned.id } });
  assert.equal(nextOne.status, 201);
  sent = [];
  assert.equal(await server.reminders(later + 3 * H), 0);
  assert.equal(sent.length, 0);

  // Weeks late, a reminder isn't helpful.
  await setPoll({ repeat: 'monthly', notifyEmail: 'sam@example.com' }, T + 60 * DAY);
  sent = [];
  assert.equal(await server.reminders(T + 60 * DAY + REMINDER_WINDOW_MS + DAY), 0);
  assert.equal(sent.length, 0);
});

test('without an email service, nothing is sent and nothing is marked', async () => {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  await store.createEvent({ id: 'p1', event: { ...poll, repeat: 'monthly' }, adminHash: 'x', now: T });
  await store.setFinal('p1', T);
  await store.setNotify('p1', { email: 'sam@example.com', unsubscribeToken: 'u', origin: 'https://v.example' });
  const fetchImpl = async () => assert.fail('no email without a service');
  assert.equal(await sendReminders({ store, env: {}, now: T + DAY, fetchImpl }), 0);
  assert.deepEqual(await store.dueReminders(T + DAY, T - DAY), ['p1']);
  // A failed send is logged and doesn't stop the run; the poll was marked first, so it's not retried.
  const failing = async () => new Response('{}', { status: 500 });
  const errors = [];
  const log = console.error;
  console.error = (...a) => errors.push(a);
  try {
    assert.equal(await sendReminders({ store, env, now: T + DAY, fetchImpl: failing }), 0);
  } finally {
    console.error = log;
  }
  assert.equal(errors.length, 1);
  assert.deepEqual(await store.dueReminders(T + DAY, T - DAY), []);
  assert.equal(await store.markReminded('p1', T, 'email'), false);
});

test('polls from before origins were saved use PUBLIC_URL, or are skipped without it', async () => {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  for (const id of ['a', 'b']) {
    await store.createEvent({ id, event: { ...poll, repeat: 'biweekly' }, adminHash: 'x', now: T });
    await store.setFinal(id, T);
  }
  await store.setNotify('a', { email: 'sam@example.com', unsubscribeToken: 'u', emailsSent: 3 });
  const mails = [];
  const fetchImpl = async (url, init) => (mails.push(JSON.parse(init.body)), new Response('{}'));
  assert.equal(await sendReminders({ store, env, now: T + DAY, fetchImpl, origin: 'https://venn.example/' }), 1);
  assert.equal(mails[0].subject, 'Time to plan the next Book club?');
  assert.ok(mails[0].text.includes('https://venn.example/new/pick?copy=a&next=biweekly'));
  assert.equal((await store.getNotify('a')).emailsSent, 4);
  // 'b' has no email: skipped, once.
  assert.deepEqual(await store.dueReminders(T + DAY, T - DAY), []);

  const other = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  await other.createEvent({ id: 'c', event: { ...poll, repeat: 'weekly' }, adminHash: 'x', now: T });
  await other.setFinal('c', T);
  await other.setNotify('c', { email: 'sam@example.com', unsubscribeToken: 'u' });
  assert.equal(await sendReminders({ store: other, env, now: T + DAY, fetchImpl }), 0);
  assert.equal(mails.length, 1);
  // Deleting a poll forgets its reminder too.
  await other.deleteEvent('c');
  assert.deepEqual(await other.dueReminders(T + DAY, T - DAY), []);
});

/** Cloudflare D1, played by node:sqlite, so the Worker's own code path runs. */
function fakeD1(db) {
  return {
    prepare: (sql) => ({
      bind: (...params) => ({
        run: async () => ({ meta: { changes: db.prepare(sql).run(...params).changes } }),
        all: async () => ({ results: db.prepare(sql).all(...params) }),
        first: async () => db.prepare(sql).get(...params) ?? null,
      }),
    }),
  };
}

test("the Worker's cron trigger sends the reminders, with Cloudflare's email binding", async () => {
  const db = new DatabaseSync(':memory:');
  const store = createStore(d1Adapter(fakeD1(db)));
  await store.createEvent({ id: 'w1', event: { ...poll, repeat: 'monthly' }, adminHash: 'x', now: T });
  await store.setFinal('w1', T);
  await store.setNotify('w1', { email: 'sam@example.com', unsubscribeToken: 'u', origin: 'https://venn.example' });
  const mails = [];
  const workerEnv = { DB: fakeD1(db), EMAIL_FROM: 'Venn <hi@venn.example>', EMAIL: { send: async (m) => mails.push(m) } };
  const waits = [];
  await worker.scheduled({ scheduledTime: T + DAY }, workerEnv, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'sam@example.com');
  assert.equal(mails[0].subject, 'Time to plan next month’s Book club?');
  // Marked through D1: the next run sends nothing.
  await worker.scheduled({ scheduledTime: T + DAY + H }, workerEnv, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(mails.length, 1);
  assert.equal(await store.markReminded('w1', T, 'email'), false);
  assert.equal(await store.markReminded('w2', T, 'email'), true);
});
