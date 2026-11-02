import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { INVITES_PER_DAY, MAX_INVITEES, MAX_INVITE_EMAILS, inviteRoom, normalizeInvitees } from '../src/invites.js';
import { inviteEmail } from '../src/notify.js';
import { parseEmails } from '../public/parse-emails.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 10, 1, 12);

// ---------- unit ----------

test('a pasted list of emails: any separator, names and repeats dropped, mistakes kept to fix', () => {
  const pasted = `Ana Smith <Ana@Example.com>, lee@example.com; kim@example.com
  lee@example.com   "Bo" <bo@example.org>
  mailto:sam@example.com, bob@, (jo@example.net)`;
  assert.deepEqual(parseEmails(pasted), {
    emails: ['ana@example.com', 'lee@example.com', 'kim@example.com', 'bo@example.org', 'sam@example.com', 'jo@example.net'],
    invalid: ['bob@'],
    repeats: 1,
  });
  assert.deepEqual(parseEmails(''), { emails: [], invalid: [], repeats: 0 });
  assert.deepEqual(parseEmails('just some words'), { emails: [], invalid: [], repeats: 0 });
});

test('the server cleans the list too, and caps it', () => {
  assert.deepEqual(normalizeInvitees([' Ana@Example.com', 'ana@example.com', '']), ['ana@example.com']);
  assert.deepEqual(normalizeInvitees(undefined), []);
  assert.throws(() => normalizeInvitees('a@b.co'), /list/);
  assert.throws(() => normalizeInvitees(['nope']), /Check this email: nope/);
  const many = Array.from({ length: MAX_INVITEES + 1 }, (_, i) => `p${i}@example.com`);
  assert.throws(() => normalizeInvitees(many), /at most 50/);
});

test('invitations are limited per poll and per account a day', async () => {
  const store = { sendsOn: async () => INVITES_PER_DAY - 3 };
  assert.equal(await inviteRoom({ store, userId: 'u1', count: 3, now: START }), null);
  assert.equal(await inviteRoom({ store, userId: 'u1', count: 4, now: START }), 'You can email 3 more people today');
  const full = { sendsOn: async () => INVITES_PER_DAY };
  assert.match(await inviteRoom({ store: full, userId: 'u1', count: 1, now: START }), /as many people as you can today/);
  const settings = { remind: { invitesSent: MAX_INVITE_EMAILS - 1 } };
  assert.equal(await inviteRoom({ store, settings, count: 2, now: START }), 'This poll can email 1 more person');
  assert.equal(await inviteRoom({ store, count: 0, now: START }), null);
});

test('the invitation: from the organizer, one tap to answer, and a way to stop', () => {
  const m = inviteEmail({
    title: 'Book club',
    organizer: 'Sam',
    closes: 'Fri, Nov 6, 5:00 PM EST',
    pollUrl: 'https://venn.day/e/abc',
    answerUrl: 'https://venn.day/e/abc#invited=ana%40example.com',
    unsubscribeUrl: 'https://venn.day/e/abc#unsubscribe=x.y',
  });
  assert.equal(m.subject, 'Sam invited you: when works for “Book club”?');
  assert.match(m.text, /Answers close Fri, Nov 6/);
  assert.match(m.html, /#invited=ana%40example\.com/);
  assert.match(m.html, /Stop emails about this poll/);
  const vote = inviteEmail({
    title: '<b>Pizza</b>',
    organizer: '',
    topic: true,
    pollUrl: 'https://venn.day/e/p',
    unsubscribeUrl: 'https://venn.day/e/p#unsubscribe=v',
  });
  assert.equal(vote.subject, 'Someone wants your vote: “<b>Pizza</b>”');
  assert.doesNotMatch(vote.html, /<b>Pizza/);
});

// ---------- API ----------

let server, base, sent, clock;
const env = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Venn <notify@venn.example>', EMAIL_SIGNIN: 'off' };

beforeEach(async () => {
  sent = [];
  clock = START;
  const fakeFetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
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
  organizer: 'Sam',
  timezone: 'America/New_York',
  mode: 'options',
  options: [{ start: slot, end: slot + HOUR }],
  hostAvailability: {},
};

test('a new poll is emailed to everyone listed, no deadline needed; added people get it once', async () => {
  const made = await call('/api/events', {
    method: 'POST',
    body: { ...poll, invitees: ['ana@example.com', 'Lee@example.com', 'ana@example.com'] },
  });
  assert.equal(made.status, 201);
  const { id } = made.data;
  const admin = { 'x-admin-token': made.data.adminToken };
  const first = emails();
  assert.deepEqual(first.map((m) => m.to[0]).sort(), ['ana@example.com', 'lee@example.com']);
  assert.equal(first[0].subject, 'Sam invited you: when works for “Book club”?');
  assert.match(first[0].text, new RegExp(`/e/${id}#invited=`));
  assert.ok(first[0].headers['List-Unsubscribe']);
  // Venn knows who answered by their email, so the poll asks for it; guests never see the list.
  const guest = await call(`/api/events/${id}`);
  assert.equal(guest.data.requireEmail, true);
  assert.doesNotMatch(JSON.stringify(guest.data), /ana@example/);
  assert.equal((await call(`/api/events/${id}/invitees`)).status, 403);

  // Ana answers; Kim and Ana's again are added: only Kim gets an email.
  await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name: 'Ana', email: 'ana@example.com', availability: { [slot]: 2 } },
  });
  sent = [];
  const added = await call(`/api/events/${id}/invitees`, {
    method: 'PUT',
    body: { invitees: ['ana@example.com', 'lee@example.com', 'kim@example.com'] },
    headers: admin,
  });
  assert.equal(added.status, 200);
  assert.deepEqual(
    emails().map((m) => m.to[0]),
    ['kim@example.com'],
  );
  assert.deepEqual(
    added.data.invitees.map((i) => [i.email, i.invited, i.answered]),
    [
      ['ana@example.com', true, true],
      ['lee@example.com', true, false],
      ['kim@example.com', true, false],
    ],
  );
  // Someone who answered before being listed isn't emailed.
  await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name: 'Jo', email: 'jo@example.com', availability: { [slot]: 2 } },
  });
  sent = [];
  await call(`/api/events/${id}/invitees`, {
    method: 'PUT',
    body: { invitees: ['ana@example.com', 'lee@example.com', 'kim@example.com', 'jo@example.com'] },
    headers: admin,
  });
  assert.equal(emails().length, 0);
  // Bad emails are refused.
  const bad = await call(`/api/events/${id}/invitees`, { method: 'PUT', body: { invitees: ['nope'] }, headers: admin });
  assert.equal(bad.status, 400);
});

test('a deadline added later reminds the same list; stopping the invitation stops reminders', async () => {
  const made = await call('/api/events', { method: 'POST', body: { ...poll, invitees: ['ana@example.com', 'lee@example.com'] } });
  const { id } = made.data;
  const admin = { 'x-admin-token': made.data.adminToken };
  const ana = emails().find((m) => m.to[0] === 'ana@example.com');
  assert.equal((await fetch(ana.headers['List-Unsubscribe'].slice(1, -1), { method: 'POST' })).status, 200);

  // The deadline, without a list: it keeps the one the poll has.
  const deadline = START + 4 * DAY;
  const d = await call(`/api/events/${id}/deadline`, { method: 'PUT', body: { deadline, remindEvery: 1 }, headers: admin });
  assert.equal(d.status, 200);
  assert.deepEqual(
    d.data.invitees.map((i) => [i.email, i.stopped]),
    [
      ['ana@example.com', true],
      ['lee@example.com', false],
    ],
  );
  sent = [];
  clock = START + DAY;
  assert.equal(await server.deadlines(), 1);
  assert.deepEqual(
    emails().map((m) => m.to[0]),
    ['lee@example.com'],
  );
  assert.match(emails()[0].text, /#invited=lee%40example\.com/);
});

test('no list without asking emails, nor without the server sending email', async () => {
  const made = await call('/api/events', { method: 'POST', body: { ...poll, invitees: ['ana@example.com'] } });
  const { id } = made.data;
  const admin = { 'x-admin-token': made.data.adminToken };
  await call(`/api/events/${id}/settings`, { method: 'PUT', body: { requireEmail: false }, headers: admin });
  assert.deepEqual((await call(`/api/events/${id}/invitees`, { headers: admin })).data.invitees, []);

  server.close();
  server = createApp({ env: {}, now: () => clock });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  const quiet = await call('/api/events', { method: 'POST', body: { ...poll, invitees: ['ana@example.com'] } });
  assert.equal(quiet.status, 201);
  const put = await call(`/api/events/${quiet.data.id}/invitees`, {
    method: 'PUT',
    body: { invitees: ['lee@example.com'] },
    headers: { 'x-admin-token': quiet.data.adminToken },
  });
  assert.equal(put.status, 400);
});
