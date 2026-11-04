// How long polls are kept (src/retention.js, #213).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStore, sqliteAdapter } from '../src/store.js';
import { POLL_RETENTION_DAYS, purgeOldPolls, retentionDays } from '../src/retention.js';

const DAY = 86_400_000;
const now = Date.UTC(2031, 5, 15, 12);
const ago = (d) => now - d * DAY;
const date = (ms) => new Date(ms).toISOString().slice(0, 10);

test('the retention: a year by default, POLL_RETENTION_DAYS changes it, 0 keeps polls', () => {
  assert.equal(POLL_RETENTION_DAYS, 365);
  assert.equal(retentionDays({}), 365);
  assert.equal(retentionDays({ POLL_RETENTION_DAYS: '30' }), 30);
  assert.equal(retentionDays({ POLL_RETENTION_DAYS: '0' }), 0);
  assert.equal(retentionDays({ POLL_RETENTION_DAYS: 'forever' }), 365);
  assert.equal(retentionDays({ POLL_RETENTION_DAYS: '-1' }), 365);
});

test('a poll goes once a year has passed since it was made, answered, decided and its last day or option', async () => {
  const db = new DatabaseSync(':memory:');
  const store = createStore(sqliteAdapter(db));
  const make = (id, created, event) => store.createEvent({ id, event: { title: id, ...event }, adminHash: 'h', now: created });
  const days = (...ms) => ({ dates: ms.map(date), slotMinutes: 1440, timezone: 'UTC' });

  await make('old', ago(400), days(ago(390), ago(389))); // nothing for over a year: goes
  await make('answered', ago(400), days(ago(390)));
  await store.insertParticipant({ id: 'p1', eventId: 'answered', name: 'Ana', availability: '{}', editHash: 'e', now: ago(100) });
  await make('decided', ago(400), days(ago(390)));
  await store.setFinal('decided', ago(10));
  await make('ahead', ago(400), days(ago(390), ago(-30))); // its last day is still to come
  await make('windows', ago(400), { windows: [{ date: date(ago(200)), start: 600, end: 720 }], slotMinutes: 30 });
  await make('options', ago(400), { mode: 'options', options: [{ start: ago(395) }, { start: ago(300) }] });
  await make('oldOptions', ago(400), { mode: 'options', options: [{ start: ago(395) }] }); // goes
  await make('topic', ago(400), { mode: 'topic', options: [{ id: 'a', label: 'Pizza' }] }); // goes: no dates
  await make('new', ago(20), days(ago(10)));
  await store.insertParticipant({ id: 'p2', eventId: 'old', name: 'Ben', availability: '{}', editHash: 'e', now: ago(398) });
  db.prepare('INSERT INTO participant_emails (participant_id, event_id, email) VALUES (?, ?, ?)').run(
    'p2',
    'old',
    'ben@example.com',
  );

  assert.equal(await purgeOldPolls({ store, env: { POLL_RETENTION_DAYS: '0' }, now }), 0);
  assert.equal(await purgeOldPolls({ store, now }), 3);
  const left = db
    .prepare('SELECT id FROM events ORDER BY id')
    .all()
    .map((r) => r.id);
  assert.deepEqual(left, ['ahead', 'answered', 'decided', 'new', 'options', 'windows']);
  // With everything that belonged to it.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM participants WHERE event_id = 'old'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM participant_emails').get().n, 0);
  assert.equal(await purgeOldPolls({ store, now }), 0);
});

test('a run deletes a batch at a time, oldest first', async () => {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  for (let i = 0; i < 60; i++)
    await store.createEvent({
      id: `p${i}`,
      event: { title: 'x', mode: 'topic', options: [] },
      adminHash: 'h',
      now: ago(500 - i),
    });
  assert.equal(await purgeOldPolls({ store, now }), 50);
  assert.equal(await purgeOldPolls({ store, now }), 10);
  assert.equal(await store.getEvent('p0'), null);
});
