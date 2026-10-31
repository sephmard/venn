import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { MAX_INVITEES, REMIND_EVERY, closesLabel, isClosed, nextDue, normalizeDeadline } from '../src/deadline.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 10, 1, 12); // Sun, Nov 1 2026, noon UTC

// ---------- unit ----------

test('a deadline needs required emails, a sensible time and a valid reminder choice', () => {
  const ev = { requireEmail: true };
  const at = START + 2 * DAY;
  assert.deepEqual(normalizeDeadline({}, ev, START), { deadline: null, remindEvery: null, invitees: [] });
  assert.throws(() => normalizeDeadline({ deadline: at }, {}, START), /email/);
  assert.throws(() => normalizeDeadline({ deadline: START + HOUR / 2 }, ev, START), /at least an hour/);
  assert.throws(() => normalizeDeadline({ deadline: START + 31 * DAY }, ev, START), /within 30 days/);
  assert.throws(() => normalizeDeadline({ deadline: 'soon' }, ev, START), /Choose when/);
  assert.throws(() => normalizeDeadline({ deadline: at, remindEvery: 7, invitees: ['a@b.co'] }, ev, START), /Remind/);
  assert.throws(() => normalizeDeadline({ deadline: at, invitees: 'a@b.co' }, ev, START), /list/);
  const many = Array.from({ length: MAX_INVITEES + 1 }, (_, i) => `p${i}@example.com`);
  assert.throws(() => normalizeDeadline({ deadline: at, invitees: many }, ev, START), /at most 50/);
  // Emails are cleaned and deduped; with no one to remind, there's no reminder choice.
  assert.throws(
    () => normalizeDeadline({ deadline: at, invitees: ['ana@example', 'x'] }, ev, START),
    /Check this email: ana@example/,
  );
  assert.deepEqual(
    normalizeDeadline({ deadline: at, remindEvery: 1, invitees: [' Ana@Example.com', 'ana@example.com', ''] }, ev, START),
    {
      deadline: at,
      remindEvery: 1,
      invitees: ['ana@example.com'],
    },
  );
  assert.equal(normalizeDeadline({ deadline: at, remindEvery: 1 }, ev, START).remindEvery, null);
  assert.deepEqual(REMIND_EVERY, [0, 1, 2, 3]);
});

test('answers close at the deadline, shown in the poll’s own time zone', () => {
  const ev = { deadline: Date.UTC(2026, 10, 6, 22), timezone: 'America/New_York' };
  assert.equal(closesLabel(ev), 'Fri, Nov 6, 5:00 PM EST');
  assert.equal(isClosed(ev, ev.deadline - 1), false);
  assert.equal(isClosed(ev, ev.deadline), true);
  assert.equal(isClosed({}, START), false);
});

test('the next look is the soonest of the next reminder, the day before, and the deadline', () => {
  const deadline = START + 5 * DAY;
  const remind = (r) => ({ remind: { invitees: [{ email: 'a@b.co' }], since: START, lastRound: null, ...r } });
  assert.equal(nextDue({ deadline }, remind({ every: 2 })), START + 2 * DAY);
  assert.equal(nextDue({ deadline }, remind({ every: 0 })), deadline - DAY);
  assert.equal(nextDue({ deadline }, remind({ every: 0, lastSent: true })), deadline);
  assert.equal(nextDue({ deadline }, { remind: { every: null, invitees: [] } }), deadline);
  assert.equal(nextDue({ deadline }, remind({ every: 1, closedSent: true })), null);
  assert.equal(nextDue({}, remind({ every: 1 })), null);
});

// ---------- API ----------

let server, base, sent, clock;
const env = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Venn <notify@venn.example>' };

// A fresh server for each test, so one test's polls aren't due in another's runs.
beforeEach(async () => {
  sent = [];
  clock = START;
  const fakeFetch = async (url, init) => {
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  };
  server = createApp({ env, fetchImpl: fakeFetch, now: () => clock });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
afterEach(() => server.close());

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
const emails = () => sent.filter((s) => s.url === 'https://api.resend.com/emails').map((s) => s.body);

const slot = Date.UTC(2026, 10, 10, 23);
const poll = {
  title: 'Book club',
  timezone: 'America/New_York',
  mode: 'options',
  options: [
    { start: slot, end: slot + HOUR },
    { start: slot + DAY, end: slot + DAY + HOUR },
  ],
  requireEmail: true,
  hostAvailability: {},
};
const deadline = START + 4 * DAY; // Thu, Nov 5, noon UTC

async function create(extra = {}) {
  const { status, data } = await call('/api/events', {
    method: 'POST',
    body: { ...poll, deadline, remindEvery: 1, invitees: ['ana@example.com', 'lee@example.com', 'kim@example.com'], ...extra },
  });
  assert.equal(status, 201, JSON.stringify(data));
  return { id: data.id, admin: { 'x-admin-token': data.adminToken } };
}
const answer = (id, name, email) =>
  call(`/api/events/${id}/participants`, { method: 'POST', body: { name, email, availability: { [slot]: 2 } } });

test('the organizer sets a deadline and who to remind; guests see only when answers close', async () => {
  const { id, admin } = await create();
  const guest = await call(`/api/events/${id}`);
  assert.equal(guest.data.deadline, deadline);
  assert.doesNotMatch(JSON.stringify(guest.data), /ana@example\.com/);

  assert.equal((await call(`/api/events/${id}/deadline`)).status, 403);
  await answer(id, 'Ana', 'ana@example.com');
  const view = await call(`/api/events/${id}/deadline`, { headers: admin });
  assert.deepEqual(view.data, {
    deadline,
    remindEvery: 1,
    invitees: [
      { email: 'ana@example.com', answered: true, reminded: 0, stopped: false },
      { email: 'lee@example.com', answered: false, reminded: 0, stopped: false },
      { email: 'kim@example.com', answered: false, reminded: 0, stopped: false },
    ],
  });

  // Changing it: a guest can't, the organizer can.
  const later = deadline + DAY;
  const change = { deadline: later, remindEvery: 2, invitees: ['lee@example.com'] };
  assert.equal((await call(`/api/events/${id}/deadline`, { method: 'PUT', body: change })).status, 403);
  const changed = await call(`/api/events/${id}/deadline`, { method: 'PUT', body: change, headers: admin });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.deadline, later);
  assert.deepEqual(
    changed.data.invitees.map((i) => i.email),
    ['lee@example.com'],
  );
  assert.equal((await call(`/api/events/${id}`)).data.deadline, later);

  // Bad input is refused; no deadline takes it off.
  const bad = await call(`/api/events/${id}/deadline`, { method: 'PUT', body: { deadline: START }, headers: admin });
  assert.equal(bad.status, 400);
  const off = await call(`/api/events/${id}/deadline`, { method: 'PUT', body: { deadline: null }, headers: admin });
  assert.deepEqual(off.data, { deadline: null, remindEvery: null, invitees: [] });
  assert.equal((await call(`/api/events/${id}`)).data.deadline, undefined);
});

test('a deadline needs the poll to ask for emails, and goes when that is turned off', async () => {
  const refused = await call('/api/events', { method: 'POST', body: { ...poll, requireEmail: false, deadline } });
  assert.equal(refused.status, 400);
  const { id, admin } = await create();
  await call(`/api/events/${id}/settings`, { method: 'PUT', body: { requireEmail: false }, headers: admin });
  assert.equal((await call(`/api/events/${id}`)).data.deadline, undefined);
  assert.equal((await call(`/api/events/${id}/deadline`, { headers: admin })).data.deadline, null);
  clock = deadline + HOUR;
  await server.deadlines();
  assert.equal(emails().length, 0);
});

test('after the deadline only the organizer can answer', async () => {
  const { id, admin } = await create();
  const ana = await answer(id, 'Ana', 'ana@example.com');
  clock = deadline;
  const late = await answer(id, 'Lee', 'lee@example.com');
  assert.equal(late.status, 403);
  assert.match(late.data.error, /Answers closed on Thu, Nov 5, 7:00 AM EST/);
  const edit = await call(`/api/events/${id}/participants/${ana.data.id}`, {
    method: 'PUT',
    body: { name: 'Ana', email: 'ana@example.com', availability: {} },
    headers: { 'x-edit-token': ana.data.editToken },
  });
  assert.equal(edit.status, 403);
  const host = await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name: 'Sam', availability: { [slot]: 2 } },
    headers: admin,
  });
  assert.notEqual(host.status, 403);
});

test('reminders go to invitees who haven’t answered, can be stopped, and end with the organizer’s email', async () => {
  const { id, admin } = await create({ notifyEmail: 'sam@example.com', remindEvery: 2 });
  await answer(id, 'Ana', 'ana@example.com');
  sent = [];

  // Nothing is due yet.
  clock = START + DAY;
  assert.equal(await server.deadlines(), 0);

  // Two days in: a reminder to Lee and Kim, who haven't answered.
  clock = START + 2 * DAY;
  assert.equal(await server.deadlines(), 2);
  const first = emails();
  assert.deepEqual(first.map((m) => m.to[0]).sort(), ['kim@example.com', 'lee@example.com']);
  assert.equal(first[0].subject, 'When works for “Book club”?');
  assert.equal(first[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  // Run again in the same hour: nothing more.
  sent = [];
  assert.equal(await server.deadlines(), 0);

  // Kim stops them with the one-click link.
  const kim = first.find((m) => m.to[0] === 'kim@example.com');
  const link = kim.headers['List-Unsubscribe'].slice(1, -1);
  assert.equal((await fetch(link, { method: 'POST' })).status, 200);
  // Someone else's id with a made-up token does nothing.
  const forged = link.replace(/\.\w+$/, '.nope');
  assert.equal((await fetch(forged, { method: 'POST' })).status, 400);

  // The day before: the last chance, to Lee only.
  sent = [];
  clock = deadline - DAY;
  assert.equal(await server.deadlines(), 1);
  assert.deepEqual(
    emails().map((m) => [m.to[0], m.subject]),
    [['lee@example.com', 'Last chance: when works for “Book club”?']],
  );
  const view = (await call(`/api/events/${id}/deadline`, { headers: admin })).data;
  assert.deepEqual(
    view.invitees.map((i) => [i.email, i.answered, i.reminded, i.stopped]),
    [
      ['ana@example.com', true, 0, false],
      ['lee@example.com', false, 2, false],
      ['kim@example.com', false, 1, true],
    ],
  );

  // At the deadline: the organizer hears the answers are in, with the best time, once.
  sent = [];
  clock = deadline;
  assert.equal(await server.deadlines(), 1);
  const [closed] = emails();
  assert.equal(closed.to[0], 'sam@example.com');
  assert.equal(closed.subject, 'Answers are in for “Book club”');
  assert.match(closed.text, /Tue, Nov 10/);
  assert.match(closed.text, /1 person answered/);
  sent = [];
  clock = deadline + DAY;
  assert.equal(await server.deadlines(), 0);
});

test('without the server’s email nothing is sent, and answers still close', async () => {
  const quiet = createApp({ env: {}, now: () => clock });
  await new Promise((r) => quiet.listen(0, r));
  try {
    const url = `http://localhost:${quiet.address().port}`;
    const res = await fetch(`${url}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...poll, deadline, remindEvery: 1, invitees: ['lee@example.com'] }),
    });
    assert.equal(res.status, 201);
    const { id } = await res.json();
    clock = deadline - DAY;
    assert.equal(await quiet.deadlines(), 0);
    clock = deadline;
    assert.equal(await quiet.deadlines(), 0);
    const late = await fetch(`${url}/api/events/${id}/participants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Lee', email: 'lee@example.com', availability: {} }),
    });
    assert.equal(late.status, 403);
  } finally {
    quiet.close();
  }
});
