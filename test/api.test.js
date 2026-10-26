import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.js';
import { SECURITY_HEADERS } from '../src/security-headers.js';

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
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const newEvent = {
  title: 'Coffee <script>',
  organizer: 'Sam',
  timezone: 'Europe/London',
  dates: ['2026-11-02'],
  startMinute: 600,
  endMinute: 720,
  slotMinutes: 30,
  durationMinutes: 60,
};

test('full poll lifecycle', async () => {
  const created = await call('/api/events', { method: 'POST', body: newEvent });
  assert.equal(created.status, 201);
  const { id, adminToken } = created.data;

  let ev = (await call(`/api/events/${id}`)).data;
  assert.equal(ev.title, 'Coffee <script>');
  assert.equal(ev.slots.length, 4);
  assert.equal(ev.isAdmin, false);
  assert.equal(ev.adminHash, undefined);
  assert.equal((await call(`/api/events/${id}`, { headers: { 'x-admin-token': adminToken } })).data.isAdmin, true);

  const [s0, s1] = ev.slots;
  const ann = await call(`/api/events/${id}/participants`, {
    method: 'POST',
    body: { name: 'Ann', availability: { [s0]: 2, [s1]: 1 } },
  });
  assert.equal(ann.status, 201);
  const bob = await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Bob', availability: {} } });

  // Bob can't edit Ann's response, Ann can.
  const annPath = `/api/events/${id}/participants/${ann.data.id}`;
  assert.equal(
    (
      await call(annPath, {
        method: 'PUT',
        body: { name: 'Ann', availability: {} },
        headers: { 'x-edit-token': bob.data.editToken },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(annPath, {
        method: 'PUT',
        body: { name: 'Ann B', availability: { [s0]: 2 } },
        headers: { 'x-edit-token': ann.data.editToken },
      })
    ).status,
    200,
  );

  ev = (await call(`/api/events/${id}`)).data;
  assert.deepEqual(
    ev.participants.map((p) => p.name),
    ['Bob', 'Ann B'],
  );
  assert.equal(ev.participants[0].editHash, undefined);
  assert.deepEqual(ev.participants[1].availability, { [s0]: 2 });

  // Finalize: organizer only, must be a real slot.
  const fin = `/api/events/${id}/finalize`;
  assert.equal((await call(fin, { method: 'POST', body: { start: s0 } })).status, 403);
  assert.equal((await call(fin, { method: 'POST', body: { start: 5 }, headers: { 'x-admin-token': adminToken } })).status, 400);
  assert.equal((await call(fin, { method: 'POST', body: { start: s0 }, headers: { 'x-admin-token': adminToken } })).status, 200);
  const ics = await call(`/api/events/${id}/event.ics`);
  assert.match(ics.data, /BEGIN:VEVENT/);
  assert.match(ics.data, /DTSTART:20261102T100000Z/);

  // Organizer can remove someone; then delete the poll.
  assert.equal(
    (await call(`/api/events/${id}/participants/${bob.data.id}`, { method: 'DELETE', headers: { 'x-admin-token': adminToken } }))
      .status,
    200,
  );
  assert.equal((await call(`/api/events/${id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await call(`/api/events/${id}`, { method: 'DELETE', headers: { 'x-admin-token': adminToken } })).status, 200);
  assert.equal((await call(`/api/events/${id}`)).status, 404);
});

test('organizer privacy: required emails, hidden names, hidden answers', async () => {
  const created = await call('/api/events', { method: 'POST', body: { ...newEvent, requireEmail: true, hideNames: true } });
  assert.equal(created.status, 201);
  const { id, adminToken } = created.data;
  const admin = { 'x-admin-token': adminToken };
  let ev = (await call(`/api/events/${id}`)).data;
  assert.equal(ev.requireEmail, true);
  assert.equal(ev.hideNames, true);
  assert.equal(ev.hideResults, undefined);
  const [s0, s1] = ev.slots;

  // An email is required, and must be a real address.
  const answer = (name, email, availability = { [s0]: 2 }) =>
    call(`/api/events/${id}/participants`, { method: 'POST', body: { name, availability, email } });
  assert.equal((await answer('Ann')).status, 400);
  assert.equal((await answer('Ann', 'not an email')).status, 400);
  const ann = (await answer('Ann', 'Ann@Example.com')).data;
  const bo = (await answer('Bo', 'bo@example.com', { [s1]: 1 })).data;

  // Guests see answers, but not names or emails.
  ev = (await call(`/api/events/${id}`)).data;
  assert.deepEqual(
    ev.participants.map((p) => p.name),
    ['Guest 1', 'Guest 2'],
  );
  assert.ok(ev.participants.every((p) => !('email' in p)));
  assert.equal(ev.participants[1].availability[s1], 1);
  // People see their own name and email, and nobody else's.
  ev = (await call(`/api/events/${id}`, { headers: { 'x-edit-token': ann.editToken } })).data;
  assert.deepEqual(
    ev.participants.map((p) => [p.name, p.email]),
    [
      ['Ann', 'ann@example.com'],
      ['Guest 1', undefined],
    ],
  );
  // The organizer sees everyone, with emails.
  ev = (await call(`/api/events/${id}`, { headers: admin })).data;
  assert.deepEqual(
    ev.participants.map((p) => [p.name, p.email]),
    [
      ['Ann', 'ann@example.com'],
      ['Bo', 'bo@example.com'],
    ],
  );

  // Changing an answer keeps the email required, and can change it.
  const put = (body) =>
    call(`/api/events/${id}/participants/${bo.id}`, { method: 'PUT', body, headers: { 'x-edit-token': bo.editToken } });
  assert.equal((await put({ name: 'Bo', availability: {} })).status, 400);
  assert.equal((await put({ name: 'Bo', availability: {}, email: 'bo@new.example' })).status, 200);

  // Only the organizer can change the settings.
  const settings = (body, headers = admin) => call(`/api/events/${id}/settings`, { method: 'PUT', body, headers });
  assert.equal((await settings({ hideResults: true }, {})).status, 403);
  assert.equal((await settings({ hideResults: 'yes' })).status, 400);
  assert.deepEqual((await settings({ hideResults: true, hideNames: false })).data, {
    requireEmail: true,
    hideNames: false,
    hideResults: true,
  });

  // Hidden answers: guests see only their own answer and how many people answered.
  ev = (await call(`/api/events/${id}`)).data;
  assert.deepEqual(ev.participants, []);
  assert.equal(ev.responses, 2);
  assert.equal(ev.title, newEvent.title);
  ev = (await call(`/api/events/${id}`, { headers: { 'x-edit-token': bo.editToken } })).data;
  assert.deepEqual(
    ev.participants.map((p) => [p.name, p.email]),
    [['Bo', 'bo@new.example']],
  );
  ev = (await call(`/api/events/${id}`, { headers: admin })).data;
  assert.equal(ev.participants.length, 2);
  assert.equal(ev.responses, undefined);

  // Removing an answer removes its email; deleting the poll removes the rest.
  await call(`/api/events/${id}/participants/${ann.id}`, { method: 'DELETE', headers: { 'x-edit-token': ann.editToken } });
  ev = (await call(`/api/events/${id}`, { headers: admin })).data;
  assert.deepEqual(
    ev.participants.map((p) => p.email),
    ['bo@new.example'],
  );
  assert.equal((await call(`/api/events/${id}`, { method: 'DELETE', headers: admin })).status, 200);
});

test("the organizer's own answer, and editing a poll until someone else answers", async () => {
  const created = await call('/api/events', { method: 'POST', body: { ...newEvent, hostAnswers: true } });
  assert.equal(created.status, 201);
  const { id, adminToken, participant } = created.data;
  const admin = { 'x-admin-token': adminToken };
  assert.ok(participant.id && participant.editToken);

  // The times offered are the organizer's answer: yes to all of them, under their name.
  let ev = (await call(`/api/events/${id}`, { headers: admin })).data;
  assert.equal(ev.hostId, participant.id);
  assert.equal(ev.participants.length, 1);
  assert.equal(ev.participants[0].name, 'Sam');
  assert.deepEqual(Object.values(ev.participants[0].availability), [2, 2, 2, 2]);
  // Guests aren't told which answer is the organizer's.
  assert.equal((await call(`/api/events/${id}`)).data.hostId, undefined);

  // Only the organizer can change the poll; the organizer's answer follows the new times.
  const edit = (body, headers = admin) => call(`/api/events/${id}`, { method: 'PUT', body, headers });
  const changed = { ...newEvent, title: 'Coffee, later', startMinute: 780, endMinute: 900, hideNames: true };
  assert.equal((await edit(changed, {})).status, 403);
  assert.equal((await edit({ ...changed, title: '' })).status, 400);
  assert.equal((await edit(changed)).status, 200);
  ev = (await call(`/api/events/${id}`, { headers: admin })).data;
  assert.equal(ev.title, 'Coffee, later');
  assert.equal(ev.hideNames, true);
  assert.equal(ev.slots.length, 4);
  assert.deepEqual(Object.keys(ev.participants[0].availability).map(Number), ev.slots);

  // Once someone else answers, the poll can't be changed any more.
  await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Ann', availability: {} } });
  const refused = await edit({ ...changed, title: 'Too late' });
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /Duplicate it instead/);

  // The organizer can mark their own answer: only some times, or only if needed.
  const [t0, t1] = (await call(`/api/events/${(await call('/api/events', { method: 'POST', body: newEvent })).data.id}`)).data
    .slots;
  const marked = (
    await call('/api/events', {
      method: 'POST',
      body: { ...newEvent, hostAnswers: true, hostAvailability: { [t0]: 1, [t1]: 2, 123: 2 } }, // 123 isn't a time: ignored
    })
  ).data;
  ev = (await call(`/api/events/${marked.id}`, { headers: { 'x-admin-token': marked.adminToken } })).data;
  assert.deepEqual(ev.participants[0].availability, { [ev.slots[0]]: 1, [ev.slots[1]]: 2 });

  // Without hostAnswers, nobody has answered a new poll.
  const plain = (await call('/api/events', { method: 'POST', body: newEvent })).data;
  assert.equal(plain.participant, undefined);
  assert.equal((await call(`/api/events/${plain.id}`)).data.participants.length, 0);
});

test('specific-times poll: votes and finalize use the option end', async () => {
  const start = Date.UTC(2026, 10, 4, 15);
  const { data } = await call('/api/events', {
    method: 'POST',
    body: {
      title: 'Lunch',
      timezone: 'UTC',
      mode: 'options',
      options: [
        { start, end: start + 45 * 60_000 },
        { start: start + 86_400_000, end: start + 86_400_000 + 3_600_000 },
      ],
    },
  });
  const ev = (await call(`/api/events/${data.id}`)).data;
  assert.deepEqual(ev.slots, [start, start + 86_400_000]);
  const vote = await call(`/api/events/${data.id}/participants`, {
    method: 'POST',
    body: { name: 'Ann', availability: { [start]: 2, [start + 86_400_000]: 1 } },
  });
  assert.equal(vote.status, 201);
  await call(`/api/events/${data.id}/finalize`, {
    method: 'POST',
    body: { start },
    headers: { 'x-admin-token': data.adminToken },
  });
  const ics = await call(`/api/events/${data.id}/event.ics`);
  assert.match(ics.data, /DTEND:20261104T154500Z/);
});

test('validation errors come back as 400', async () => {
  const r = await call('/api/events', { method: 'POST', body: { ...newEvent, dates: [] } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /date/);
  const created = await call('/api/events', { method: 'POST', body: newEvent });
  const p = await call(`/api/events/${created.data.id}/participants`, { method: 'POST', body: { name: '', availability: {} } });
  assert.equal(p.status, 400);
});

test('serves the landing page, the app on its routes, and a 404 for anything else', async () => {
  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /href="\/new\/pick"/);
  for (const path of ['/new', '/e/whatever']) {
    const res = await fetch(baseUrl + path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /<main id="app"/, path);
  }
  const privacy = await fetch(`${baseUrl}/privacy`);
  assert.equal(privacy.status, 200);
  assert.match(await privacy.text(), /<h1>Privacy<\/h1>/);
  const missing = await fetch(`${baseUrl}/nope`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Page not found/);
  const js = await fetch(`${baseUrl}/core.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  const traversal = await fetch(`${baseUrl}/..%2f..%2fpackage.json`);
  assert.doesNotMatch(await traversal.text(), /"scripts"/);
});

test('security headers on pages and API responses', async () => {
  for (const path of ['/', '/new', '/e/abc', '/nope', '/app.js', '/api/events/nope']) {
    const res = await fetch(baseUrl + path);
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
      assert.equal(res.headers.get(name), value, `${name} on ${path}`);
  }
});

test('public/_headers matches the security headers used by the servers', () => {
  const lines = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
    .trim()
    .split('\n');
  assert.equal(lines[0], '/*');
  const parsed = Object.fromEntries(
    lines.slice(1).map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()];
    }),
  );
  assert.deepEqual(parsed, SECURITY_HEADERS);
});

test('config files in public/ are not served', async () => {
  const text = await (await fetch(`${baseUrl}/_headers`)).text();
  assert.doesNotMatch(text, /Content-Security-Policy/);
});

test('writes must be JSON', async () => {
  const res = await fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ title: 'x' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /JSON/);
});
