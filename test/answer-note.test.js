// A one-line note on an answer ("Can only stay till 9"): cleaned and limited, kept with its
// answer, shown only where the answer's name may be, and sent nowhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../src/api.js';
import { createStore, sqliteAdapter } from '../src/store.js';
import { normalizeNote } from '../src/validate.js';
import { YES } from '../public/core.js';

// The API, with email through a stand-in for Resend, webhooks and AI recorded, usage counted,
// a clock the test moves, and the background work awaited.
const db = new DatabaseSync(':memory:');
const store = createStore(sqliteAdapter(db));
const sent = [];
const prompts = [];
const pending = [];
let clock = Date.UTC(2030, 0, 1, 12);
const env = {
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'Venn <notify@venn.example>',
  EMAIL_SIGNIN: 'off',
  STATS_TOKEN: 'stats',
  ANTHROPIC_API_KEY: 'sk-test',
  AI_RATE_LIMIT: '1000',
};
const fetchImpl = async (url, init) => {
  sent.push({ url: String(url), body: init.body });
  return new Response('{}', { status: 200 });
};
const anthropic = {
  beta: {
    messages: {
      create: async (params) => {
        prompts.push(JSON.stringify(params));
        const text = JSON.stringify({ summary: 'Fine.', recommendedOption: 1, reason: 'Most can.' });
        return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text }] };
      },
    },
  },
};
async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await handleApi(
    new Request(`https://venn.day${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body && JSON.stringify(body),
    }),
    store,
    {
      env,
      fetchImpl,
      anthropic,
      now: () => clock,
      resolveHost: async () => ['93.184.216.34'],
      waitUntil: (p) => pending.push(p),
      clientIp: '127.0.0.1',
    },
  );
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  await Promise.all(pending.splice(0));
  return { status: res.status, data };
}
const H = 3_600_000;
const slot = Date.UTC(2030, 0, 10, 19);

/** A date poll (settings `more`), with the organizer's link and Ana's answer and note. */
async function poll(more = {}) {
  const { data } = await call('/api/events', {
    method: 'POST',
    body: { title: 'Book club', timezone: 'UTC', mode: 'options', options: [{ start: slot, end: slot + H }], ...more },
  });
  const admin = { 'x-admin-token': data.adminToken };
  const path = `/api/events/${data.id}`;
  const answer = (name, note, extra = {}) =>
    call(`${path}/participants`, { method: 'POST', body: { name, availability: { [slot]: YES }, note, ...extra } });
  const ana = (await answer('Ana', 'Can only stay till 9')).data;
  return { id: data.id, path, admin, answer, ana, mine: { 'x-edit-token': ana.editToken } };
}
const notesOf = (ev) => Object.fromEntries(ev.participants.map((p) => [p.name, p.note]));
const noteRows = () => db.prepare('SELECT participant_id, event_id, note FROM participant_notes').all();

test('a note is one clean line of at most 120 characters', () => {
  assert.equal(normalizeNote('  can host\n\tafter 7  '), 'can host after 7');
  assert.equal(normalizeNote('a\u0007b‮c⁦d​e﻿f‍g'), 'a b c d e f g');
  assert.equal(normalizeNote(' ​\n '), null);
  assert.equal(normalizeNote(''), null);
  assert.equal(normalizeNote(undefined), null);
  assert.equal(normalizeNote('x'.repeat(120)), 'x'.repeat(120));
  // Whole characters: 120 emoji are 120, not 240.
  assert.equal(normalizeNote('🍝'.repeat(120)), '🍝'.repeat(120));
  assert.throws(() => normalizeNote('x'.repeat(121)), { message: 'Keep the note to 120 characters.' });
  assert.throws(() => normalizeNote(42), /must be text/);
});

test('through the API: saved with the answer, refused when too long, kept or cleared on a change', async () => {
  const { path, admin, answer, ana, mine } = await poll();
  assert.equal(notesOf((await call(path)).data).Ana, 'Can only stay till 9');

  const long = await answer('Lee', 'x'.repeat(121));
  assert.equal(long.status, 400);
  assert.equal(long.data.error, 'Keep the note to 120 characters.');
  assert.equal((await answer('Lee', 7)).status, 400);
  assert.equal((await answer('Lee', 'line one\nline two')).status, 201);
  assert.equal(notesOf((await call(path)).data).Lee, 'line one line two');

  const put = (body) => call(`${path}/participants/${ana.id}`, { method: 'PUT', body, headers: mine });
  // Left out (an older page, or the note's code didn't load): kept.
  assert.equal((await put({ name: 'Ana', availability: { [slot]: YES } })).status, 200);
  assert.equal(notesOf((await call(path)).data).Ana, 'Can only stay till 9');
  // Asking to hear the date ({ email } alone) leaves it too.
  assert.equal((await put({ email: 'ana@example.com' })).status, 200);
  assert.equal(notesOf((await call(path)).data).Ana, 'Can only stay till 9');
  // Changed, then emptied: gone.
  await put({ name: 'Ana', availability: { [slot]: YES }, note: 'Bringing dessert' });
  assert.equal(notesOf((await call(path, { headers: admin })).data).Ana, 'Bringing dessert');
  await put({ name: 'Ana', availability: { [slot]: YES }, note: '  ' });
  assert.equal('note' in (await call(path)).data.participants.find((p) => p.name === 'Ana'), false);
});

test('hidden answers or names: a guest sees only their own note, the organizer sees every one', async () => {
  for (const hide of [{ hideResults: true }, { hideNames: true }]) {
    const { path, admin, answer, mine } = await poll(hide);
    const lee = (await answer('Lee', 'Might be late')).data;
    const anyone = (await call(path)).data;
    assert.equal(JSON.stringify(anyone).includes('Can only stay till 9'), false, JSON.stringify(hide));
    assert.equal(JSON.stringify(anyone).includes('Might be late'), false, JSON.stringify(hide));
    // Ana sees hers, not Lee's.
    const ana = JSON.stringify((await call(path, { headers: mine })).data);
    assert.ok(ana.includes('Can only stay till 9'));
    assert.equal(ana.includes('Might be late'), false);
    const leeSees = JSON.stringify((await call(path, { headers: { 'x-edit-token': lee.editToken } })).data);
    assert.ok(leeSees.includes('Might be late'));
    assert.equal(leeSees.includes('Can only stay till 9'), false);
    assert.deepEqual(notesOf((await call(path, { headers: admin })).data), {
      Ana: 'Can only stay till 9',
      Lee: 'Might be late',
    });
  }
  // Nothing hidden: everyone sees everyone's.
  const { path } = await poll();
  assert.equal(notesOf((await call(path)).data).Ana, 'Can only stay till 9');
});

test('after answers close, a guest can’t change their note either', async () => {
  const deadline = clock + 2 * H;
  const { path, ana, mine } = await poll({ deadline });
  clock = deadline;
  const late = await call(`${path}/participants/${ana.id}`, {
    method: 'PUT',
    body: { name: 'Ana', availability: { [slot]: YES }, note: 'Changed my mind' },
    headers: mine,
  });
  assert.equal(late.status, 403);
  assert.equal(notesOf((await call(path)).data).Ana, 'Can only stay till 9');
  clock = Date.UTC(2030, 0, 1, 12);
});

test('a removed answer, or a deleted poll, leaves no note behind', async () => {
  db.exec('DELETE FROM participant_notes');
  const one = await poll();
  const two = await poll();
  await two.answer('Lee', 'Might be late');
  assert.equal(noteRows().length, 3);
  assert.equal((await call(`${one.path}/participants/${one.ana.id}`, { method: 'DELETE', headers: one.mine })).status, 200);
  assert.deepEqual(
    noteRows().map((r) => r.event_id),
    [two.id, two.id],
  );
  assert.equal((await call(two.path, { method: 'DELETE', headers: two.admin })).status, 200);
  assert.deepEqual(noteRows(), []);
});

test('a note is sent nowhere: not to AI, webhooks or emails; usage counts only that there is one', async () => {
  const { path, admin, ana, mine } = await poll({ requireEmail: false });
  await call(`${path}/notifications`, {
    method: 'PUT',
    body: { email: 'sam@example.com', webhookUrl: 'https://example.com/hook' },
    headers: admin,
  });
  sent.length = 0;
  prompts.length = 0;
  // A new answer, with a copy to its writer, and a change: the organizer is told both ways.
  const lee = await call(`${path}/participants`, {
    method: 'POST',
    body: { name: 'Lee', availability: { [slot]: YES }, note: 'Bringing my kids, Ana and Leo', copyTo: 'lee@example.com' },
  });
  assert.equal(lee.status, 201);
  await call(`${path}/participants/${lee.data.id}`, {
    method: 'PUT',
    body: { name: 'Lee', availability: { [slot]: YES }, note: 'Bringing my kids, Ana and Leo' },
    headers: { 'x-edit-token': lee.data.editToken },
  });
  await call(`${path}/participants/${ana.id}`, {
    method: 'PUT',
    body: { name: 'Ana', availability: { [slot]: YES } },
    headers: mine,
  });
  const summary = await call(`${path}/ai/summary`, { method: 'POST', body: {}, headers: admin });
  assert.equal(summary.status, 200);

  assert.ok(
    sent.some((s) => s.url === 'https://example.com/hook'),
    'the webhook went',
  );
  assert.ok(
    sent.some((s) => s.url === 'https://api.resend.com/emails'),
    'emails went',
  );
  assert.ok(prompts.length, 'AI was asked');
  for (const s of sent) {
    assert.equal(s.body.includes('Bringing my kids'), false, s.url);
    assert.equal(s.body.includes('Can only stay till 9'), false, s.url);
    if (s.url === 'https://example.com/hook') assert.equal('note' in JSON.parse(s.body).response, false);
  }
  for (const p of prompts) assert.equal(p.includes('Bringing my kids') || p.includes('Can only stay till 9'), false);

  const usage = await store.listUsage('2000-01-01');
  const props = (name) => usage.filter((u) => u.name === name).map((u) => JSON.parse(u.props).note);
  assert.ok(props('answer.created').includes('yes'));
  assert.ok(props('answer.updated').includes('yes'));
  for (const u of usage) assert.equal(u.props.includes('Bringing') || u.props.includes('stay till'), false);
});
