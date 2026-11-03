// Topic polls: people vote on options that aren't times (places, books, yes or no).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { IF_NEEDED, YES, buildSlots, rankTimes } from '../public/core.js';
import { normalizeEventInput, checkSingle } from '../src/validate.js';
import { buildSummary, summaryText } from '../src/notify.js';
import { pollPreview } from '../src/preview.js';
import { pollKind, cleanUsage } from '../src/usage.js';
import { inviteText } from '../public/invite.js';
import { answeredMeta, arrange, canMake, madeMeta, mixedKinds, pollMeta } from '../public/account-data.js';
import { DatabaseSync } from 'node:sqlite';
import { createStore, sqliteAdapter } from '../src/store.js';

let server, baseUrl;
before(async () => {
  server = createApp({ dbPath: ':memory:' });
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
  return { status: res.status, data: await res.json().catch(() => null) };
}

const base = { title: 'Where should we eat?', organizer: 'Priya', timezone: 'UTC' };

test('a topic poll gets an id per option, in order', () => {
  const ev = normalizeEventInput({ ...base, mode: 'topic', options: [{ label: " Rosa's " }, 'Taco Loco'] });
  assert.deepEqual(ev.options, [
    { id: 1, label: "Rosa's" },
    { id: 2, label: 'Taco Loco' },
  ]);
  assert.equal(ev.single, undefined);
  assert.deepEqual(buildSlots(ev), [1, 2]);
});

test('a topic poll refuses empty, repeated and too many options', () => {
  const make =
    (options, extra = {}) =>
    () =>
      normalizeEventInput({ ...base, mode: 'topic', options, ...extra });
  assert.throws(make([]), /at least one option/);
  assert.throws(make(['']), /Each option is required/);
  assert.throws(make(['Rosa', 'rosa']), /in the list twice/);
  assert.throws(make(Array.from({ length: 21 }, (_, i) => `Option ${i}`)), /at most 20/);
  assert.throws(make(['Only one'], { single: true }), /at least two options/);
  assert.equal(normalizeEventInput({ ...base, mode: 'topic', options: ['Yes', 'No'], single: true }).single, true);
});

test('one pick each: an answer is yes to one option at most', () => {
  assert.deepEqual(checkSingle({ single: true }, { 2: IF_NEEDED }), { 2: YES });
  assert.throws(() => checkSingle({ single: true }, { 1: YES, 2: YES }), /Pick one/);
  assert.deepEqual(checkSingle({}, { 1: YES, 2: IF_NEEDED }), { 1: YES, 2: IF_NEEDED });
});

test('topic options rank by yes and if needed, then yes', () => {
  const ev = normalizeEventInput({ ...base, mode: 'topic', options: ['A', 'B', 'C'] });
  const people = [
    { name: 'Priya', availability: { 1: IF_NEEDED, 2: YES } },
    { name: 'Marcus', availability: { 1: YES, 2: YES } },
    { name: 'Ana', availability: { 1: YES } },
  ];
  const [best, next] = rankTimes(ev, buildSlots(ev), people);
  assert.equal(best.label, 'A');
  assert.deepEqual(best.ifNeeded, ['Priya']);
  assert.equal(next.label, 'B');
});

test('a topic poll: create, answer, pick, and the picked option in the poll', async () => {
  const { status, data } = await call('/api/events', {
    method: 'POST',
    body: { ...base, mode: 'topic', options: [{ label: "Rosa's" }, { label: 'Taco Loco' }], hostAnswers: true },
  });
  assert.equal(status, 201);
  assert.equal(data.participant, undefined, 'the organizer votes like everyone else');
  const admin = { 'x-admin-token': data.adminToken };
  const path = `/api/events/${data.id}`;
  const ans = await call(`${path}/participants`, {
    method: 'POST',
    body: { name: 'Marcus', availability: { 1: YES, 2: IF_NEEDED, 9: YES } },
  });
  assert.equal(ans.status, 201);
  let ev = (await call(path)).data;
  assert.equal(ev.mode, 'topic');
  assert.deepEqual(ev.slots, [1, 2]);
  assert.deepEqual(ev.participants[0].availability, { 1: YES, 2: IF_NEEDED });

  assert.equal((await call(`${path}/finalize`, { method: 'POST', body: { option: 1 } })).status, 403);
  assert.equal((await call(`${path}/finalize`, { method: 'POST', body: { option: 7 }, headers: admin })).status, 400);
  const fin = await call(`${path}/finalize`, { method: 'POST', body: { option: 1 }, headers: admin });
  assert.deepEqual(fin.data, { ok: true, picked: 1 });
  ev = (await call(path)).data;
  assert.equal(ev.picked, 1);
  assert.equal(ev.finalStart, null);
  // No calendar file for an option, and it says why.
  const ics = await call(`${path}/event.ics`);
  assert.equal(ics.status, 404);
  assert.equal(ics.data.error, 'A vote has no calendar file: it picks an option, not a time');
  // Changing the mind: back to open.
  await call(`${path}/finalize`, { method: 'POST', body: { option: null }, headers: admin });
  assert.equal((await call(path)).data.picked, undefined);
});

test('one pick each: the API refuses two picks', async () => {
  const { data } = await call('/api/events', {
    method: 'POST',
    body: { ...base, mode: 'topic', options: ['Yes', 'No'], single: true },
  });
  const two = await call(`/api/events/${data.id}/participants`, {
    method: 'POST',
    body: { name: 'Ana', availability: { 1: YES, 2: YES } },
  });
  assert.equal(two.status, 400);
  assert.match(two.data.error, /Pick one/);
});

test('topic polls in webhooks, link previews, invites, usage and My polls', () => {
  const ev = { id: 'abc', ...normalizeEventInput({ ...base, mode: 'topic', options: ["Rosa's", 'Taco Loco'] }) };
  const people = [{ name: 'Ana', availability: { 2: YES } }];
  const s = buildSummary(ev, people, { kind: 'response.created', name: 'Ana', origin: 'https://venn.day', now: 0 });
  assert.equal(s.bestTime, null);
  assert.deepEqual(s.bestOption, { id: 2, label: 'Taco Loco', yes: 1, ifNeeded: 0 });
  assert.equal(s.poll.mode, 'topic');
  assert.match(summaryText(s), /Leading so far: Taco Loco \(1 of 1 said yes\)/);
  const picked = buildSummary({ ...ev, picked: 1 }, people, { kind: 'poll.picked', origin: 'https://venn.day', now: 0 });
  assert.deepEqual(picked.poll.picked, { id: 1, label: "Rosa's" });
  assert.equal(summaryText(picked), "“Where should we eat?” is decided: Rosa's.");

  assert.match(pollPreview(ev).description, /Priya wants the group's pick\. 2 options/);
  assert.equal(pollPreview({ ...ev, picked: 2 }).description, 'Decided: Taco Loco');
  assert.match(inviteText({ ...ev }), /Priya wants the group's pick/);

  assert.deepEqual(pollKind(ev), { kind: 'topic', detail: 'choices' });
  assert.ok(cleanUsage('poll.created', { kind: 'topic', detail: 'yesno' }));

  assert.equal(pollMeta({ decided: "Rosa's", answers: 3 }), "Decided: Rosa's");
  assert.equal(
    madeMeta({ mode: 'topic', decided: "Rosa's", finalStart: null, answers: 3 }),
    "Vote · Decided: Rosa's · 3 answers",
  );
  assert.match(answeredMeta({ mode: 'topic', decided: null, finalStart: null, answers: 2 }), /^Vote · Waiting on a pick/);
});

test('My polls: votes are labelled, grouped on their own while open, and can be shown alone', () => {
  const now = Date.UTC(2026, 10, 1);
  const polls = [
    { id: 'a', title: 'Dinner', createdAt: 3, finalStart: null, answers: 1 },
    { id: 'b', title: 'Where to eat', mode: 'topic', decided: null, createdAt: 2, finalStart: null, answers: 2 },
    { id: 'c', title: 'Which book', mode: 'topic', decided: 'Dune', createdAt: 1, finalStart: null, answers: 4 },
  ];
  assert.equal(madeMeta(polls[0]), '1 answer');
  assert.equal(madeMeta(polls[1]), 'Vote · 2 answers');
  assert.ok(mixedKinds(polls));
  assert.ok(!mixedKinds(polls.slice(1)));
  const groups = arrange(polls, {}, now);
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((p) => p.id)]),
    [
      ['Waiting on a date', ['a']],
      ['Waiting on a pick', ['b']],
      ['Past', ['c']],
    ],
  );
  const ids = (kind) => arrange(polls, { kind, group: 'none' }, now).flatMap((g) => g.items.map((p) => p.id));
  assert.deepEqual(ids('topic'), ['b', 'c']);
  assert.deepEqual(ids('date'), ['a']);
  assert.deepEqual(ids('all'), ['a', 'b', 'c']);
  assert.deepEqual(canMake({ mode: 'topic', can: 2 }), ['v-yes', 'Your pick']);
  assert.deepEqual(canMake({ can: 2 }), ['v-yes', 'You’re in']);
});

test('My polls rows say a poll is a vote, what was picked, and whether it was your pick', async () => {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  const event = {
    title: 'Where to eat',
    mode: 'topic',
    options: [
      { id: 1, label: "Rosa's" },
      { id: 2, label: 'Taco Loco' },
    ],
    picked: 2,
  };
  await store.createEvent({ id: 'topic1', event, adminHash: 'x', now: 1 });
  await store.insertParticipant({ id: 'p1', eventId: 'topic1', name: 'Mia', availability: { 2: YES }, editHash: 'y', now: 2 });
  const user = await store.upsertUser({ provider: 'google', subject: 's1', email: 'm@example.com', name: 'Mia', now: 1 });
  await store.addOwner('poll', 'topic1', user.id, 3);
  await store.addOwner('answer', 'p1', user.id, 3);
  const [made] = await store.listOwnedPolls(user.id);
  assert.equal(made.mode, 'topic');
  assert.equal(made.decided, 'Taco Loco');
  const [answered] = await store.listAnsweredPolls(user.id);
  assert.equal(answered.mode, 'topic');
  assert.equal(answered.can, YES);
});

test('a topic answer keyed by option labels, not ids, is refused with the ids to use', async () => {
  const { data } = await call('/api/events', { method: 'POST', body: { ...base, mode: 'topic', options: ['Pizza', 'Tacos'] } });
  const res = await call(`/api/events/${data.id}/participants`, {
    method: 'POST',
    body: { name: 'Ana', availability: { Pizza: YES } },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "This poll's options changed after you opened it. Reload the page, then answer again.");
  assert.match(res.data.detail, /option id \(1, 2…\), as listed in slots/);
  const ok = await call(`/api/events/${data.id}/participants`, {
    method: 'POST',
    body: { name: 'Ana', availability: { 1: YES, Tacos: YES } },
  });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.data.ignored, ['Tacos']);
});
