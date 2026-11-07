// RSVP polls: the date is set, and guests say Going, Maybe or Can't go. Spots with a waitlist,
// plus-ones, and approval before an RSVP counts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { IF_NEEDED, YES } from '../public/core.js';
import { normalizeEventInput, normalizeRsvp } from '../src/validate.js';
import { rsvpView } from '../src/rsvp.js';
import { answersClosedEmail, deadlineReminderEmail, inviteEmail } from '../src/notify.js';
import { pollPreview } from '../src/preview.js';
import { pollKind } from '../src/usage.js';

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

const START = Date.UTC(2030, 5, 6, 18);
const END = START + 3 * 3_600_000;
const base = { title: 'Summer party', organizer: 'Priya', timezone: 'UTC', mode: 'rsvp', start: START, end: END };

async function make(rsvp = {}, extra = {}) {
  const { status, data } = await call('/api/events', { method: 'POST', body: { ...base, rsvp, hostAnswers: true, ...extra } });
  assert.equal(status, 201);
  return { id: data.id, admin: { 'x-admin-token': data.adminToken }, participant: data.participant };
}
const answer = async (id, name, v, extra = {}) => {
  const { status, data } = await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name, availability: v ? { [START]: v } : {}, ...extra },
  });
  assert.equal(status, 201, JSON.stringify(data));
  return data;
};
const statuses = (ev) => Object.fromEntries(ev.participants.map((p) => [p.name, p.rsvp.status]));

test('an RSVP is a one-option poll with its date set and its settings kept', () => {
  const ev = normalizeEventInput({ ...base, rsvp: { cap: 10, plusOnes: 2, approve: true } });
  assert.equal(ev.mode, 'options');
  assert.deepEqual(ev.options, [{ start: START, end: END }]);
  assert.deepEqual(ev.rsvp, { cap: 10, plusOnes: 2, approve: true });
  assert.deepEqual(normalizeEventInput(base).rsvp, {});
  assert.deepEqual(normalizeRsvp({ cap: null, plusOnes: 0, approve: false }), {});
  assert.throws(() => normalizeRsvp({ cap: 0 }), /Spots/);
  assert.throws(() => normalizeRsvp({ cap: 2.5 }), /Spots/);
  assert.throws(() => normalizeRsvp({ plusOnes: 9 }), /Plus-ones/);
  assert.throws(() => normalizeRsvp({ approve: 'yes' }), /approve/);
  assert.throws(() => normalizeEventInput({ ...base, end: START }), /proposed time/);
});

test('the guest list: spots fill in the order people said Going, then a waitlist', () => {
  const ev = { options: [{ start: 1, end: 2 }], rsvp: { cap: 3, plusOnes: 2 } };
  const p = (id, v, at, guests = 0) => [{ id, availability: v ? { 1: v } : {}, updatedAt: at }, [id, { guests, goingAt: at }]];
  const list = [p('a', YES, 1, 1), p('b', YES, 2, 2), p('c', YES, 3), p('d', IF_NEEDED, 4), p('e', 0, 5)];
  const { of, counts } = rsvpView(
    ev,
    list.map((x) => x[0]),
    new Map(list.map((x) => x[1])),
  );
  assert.deepEqual(of.get('a'), { status: 'going', guests: 1 });
  // b's party of three doesn't fit in the one spot left, and c doesn't skip ahead of b.
  assert.deepEqual(of.get('b'), { status: 'waitlist', guests: 2, place: 1 });
  assert.deepEqual(of.get('c'), { status: 'waitlist', guests: 0, place: 2 });
  assert.equal(of.get('d').status, 'maybe');
  assert.equal(of.get('e').status, 'no');
  assert.deepEqual(counts, { going: 2, people: 1, waitlist: 2, requested: 0, maybe: 1, no: 1, spotsLeft: 1 });
});

test('creating an RSVP sets its date, with no answer for the organizer', async () => {
  const { id, participant } = await make({ cap: 2 });
  assert.equal(participant, undefined);
  const { data: ev } = await call(`/api/events/${id}`);
  assert.equal(ev.finalStart, START);
  assert.deepEqual(ev.rsvp, { cap: 2 });
  assert.deepEqual(ev.rsvpCount, { going: 0, people: 0, waitlist: 0, requested: 0, maybe: 0, no: 0, spotsLeft: 2 });
});

test('a full RSVP puts new guests on the waitlist, and a spot that frees up goes to the first in line', async () => {
  const { id } = await make({ cap: 2, plusOnes: 1 });
  const ana = await answer(id, 'Ana', YES, { guests: 1 });
  await answer(id, 'Ben', YES);
  await answer(id, 'Cy', YES, { guests: 5 }); // more plus-ones than allowed: one
  await answer(id, 'Di', IF_NEEDED);
  let { data: ev } = await call(`/api/events/${id}`);
  assert.deepEqual(statuses(ev), { Ana: 'going', Ben: 'waitlist', Cy: 'waitlist', Di: 'maybe' });
  assert.equal(ev.participants.find((p) => p.name === 'Cy').rsvp.guests, 1);
  assert.equal(ev.rsvpCount.spotsLeft, 0);
  // Ana can't go after all: Ben is in; Cy's party of two doesn't fit in the one spot left.
  await call(`/api/events/${id}/participants/${ana.id}`, {
    method: 'PUT',
    body: { name: 'Ana', availability: {} },
    headers: { 'x-edit-token': ana.editToken },
  });
  ({ data: ev } = await call(`/api/events/${id}`));
  assert.deepEqual(statuses(ev), { Ana: 'no', Ben: 'going', Cy: 'waitlist', Di: 'maybe' });
  // Saying Going again puts Ana at the back of the line.
  await call(`/api/events/${id}/participants/${ana.id}`, {
    method: 'PUT',
    body: { name: 'Ana', availability: { [START]: YES } },
    headers: { 'x-edit-token': ana.editToken },
  });
  ({ data: ev } = await call(`/api/events/${id}`));
  assert.equal(ev.participants.find((p) => p.name === 'Ana').rsvp.place, 2);
});

test('the organizer changes spots, plus-ones and approval any time', async () => {
  const { id, admin } = await make({ cap: 1 });
  await answer(id, 'Ana', YES);
  await answer(id, 'Ben', YES);
  assert.equal((await call(`/api/events/${id}/rsvp`, { method: 'PUT', body: { cap: 5 } })).status, 403);
  assert.equal((await call(`/api/events/${id}/rsvp`, { method: 'PUT', body: { cap: 5 }, headers: admin })).status, 200);
  let { data: ev } = await call(`/api/events/${id}`);
  assert.deepEqual(statuses(ev), { Ana: 'going', Ben: 'going' });
  // Approval switched on: those already going stay in; new RSVPs wait for the organizer.
  await call(`/api/events/${id}/rsvp`, { method: 'PUT', body: { cap: 5, approve: true }, headers: admin });
  await answer(id, 'Cy', YES);
  ({ data: ev } = await call(`/api/events/${id}`));
  assert.deepEqual(statuses(ev), { Ana: 'going', Ben: 'going', Cy: 'requested' });
  assert.equal(ev.rsvpCount.requested, 1);
  assert.equal((await call(`/api/events/${id}/rsvp`, { method: 'PUT', body: { cap: 0 }, headers: admin })).status, 400);
});

test('approval: an RSVP counts once the organizer lets it in', async () => {
  const { id, admin } = await make({ approve: true, cap: 1 });
  const ana = await answer(id, 'Ana', YES);
  const ben = await answer(id, 'Ben', YES);
  const path = (p) => `/api/events/${id}/participants/${p.id}/approval`;
  assert.equal((await call(path(ana), { method: 'PUT', body: { approved: true } })).status, 403);
  assert.equal((await call(path(ana), { method: 'PUT', body: { approved: 'yes' }, headers: admin })).status, 400);
  await call(path(ben), { method: 'PUT', body: { approved: true }, headers: admin });
  await call(path(ana), { method: 'PUT', body: { approved: false }, headers: admin });
  let { data: ev } = await call(`/api/events/${id}`);
  assert.deepEqual(statuses(ev), { Ana: 'declined', Ben: 'going' });
  // Approved after Ben, with no spot left: the waitlist. Nobody let in earlier is bumped.
  await call(path(ana), { method: 'PUT', body: { approved: true }, headers: admin });
  ({ data: ev } = await call(`/api/events/${id}`));
  assert.deepEqual(statuses(ev), { Ana: 'waitlist', Ben: 'going' });
  // The organizer's own RSVP needs no approval.
  await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name: 'Priya', availability: { [START]: YES } },
    headers: admin,
  });
  ({ data: ev } = await call(`/api/events/${id}`, { headers: admin }));
  assert.equal(statuses(ev).Priya, 'waitlist');
});

test("an RSVP's date can't be picked again, and a date poll has no RSVP settings", async () => {
  const { id, admin } = await make();
  const r = await call(`/api/events/${id}/finalize`, { method: 'POST', body: { start: START }, headers: admin });
  assert.equal(r.status, 400);
  const poll = await call('/api/events', {
    method: 'POST',
    body: { ...base, mode: 'options', options: [{ start: START, end: END }] },
  });
  const headers = { 'x-admin-token': poll.data.adminToken };
  assert.equal((await call(`/api/events/${poll.data.id}/rsvp`, { method: 'PUT', body: {}, headers })).status, 404);
});

test('deleting an answer takes its place on the guest list with it', async () => {
  const { id, admin } = await make({ cap: 1 });
  const ana = await answer(id, 'Ana', YES);
  await answer(id, 'Ben', YES);
  await call(`/api/events/${id}/participants/${ana.id}`, { method: 'DELETE', headers: admin });
  const { data: ev } = await call(`/api/events/${id}`);
  assert.deepEqual(statuses(ev), { Ben: 'going' });
});

test('emails and previews speak of an RSVP', () => {
  const invite = inviteEmail({
    title: 'Party',
    organizer: 'Priya',
    rsvp: 'Sat, Jun 6',
    pollUrl: 'https://venn.day/e/x',
    unsubscribeUrl: 'https://venn.day/e/x#unsubscribe=1',
  });
  assert.match(invite.subject, /Priya invited you: “Party”, Sat, Jun 6/);
  assert.match(invite.text, /Are you coming\?/);
  const nudge = deadlineReminderEmail({
    title: 'Party',
    closes: 'Fri',
    rsvp: 'Sat, Jun 6',
    pollUrl: 'https://venn.day/e/x',
    unsubscribeUrl: 'https://venn.day/e/x#unsubscribe=1',
  });
  assert.match(nudge.subject, /Are you coming/);
  assert.match(nudge.text, /RSVPs close Fri/);
  const counts = { going: 4, people: 3, waitlist: 1, requested: 0, maybe: 2, no: 0, spotsLeft: 0 };
  const closed = answersClosedEmail({
    title: 'Party',
    rsvp: counts,
    waiting: 1,
    pollUrl: 'https://venn.day/e/x',
    unsubscribeUrl: 'https://venn.day/e/x#unsubscribe=1',
  });
  assert.match(closed.subject, /RSVPs are in/);
  assert.match(closed.text, /4 going, 1 on the waitlist, 2 maybe, 1 didn't answer\./);
  const ev = {
    title: 'Party',
    timezone: 'UTC',
    mode: 'options',
    options: [{ start: START, end: END }],
    durationMinutes: 180,
    rsvp: {},
    finalStart: START,
  };
  assert.match(pollPreview(ev).description, /Are you coming\? RSVP/);
  assert.equal(pollKind(ev).kind, 'rsvp');
});
