// `npm run staging` (scripts/staging.js): a local site filled with polls of every kind to try.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { seed } from '../scripts/staging.js';

test('staging: polls of every kind, answered, and one with its date picked', async (t) => {
  const app = createApp({ env: {} });
  await new Promise((r) => app.listen(0, r));
  t.after(() => app.close());
  const base = `http://localhost:${app.address().port}`;
  const made = await seed(base, { today: '2030-01-07' });
  assert.equal(made.length, 7);
  const polls = await Promise.all(made.map(async (p) => (await fetch(`${base}/api/events/${p.id}`)).json()));
  for (const ev of polls) assert.ok(ev.participants.length >= 3, ev.title);
  assert.equal(polls.find((ev) => ev.title === 'Reunion (a big group)').participants.length, 12);
  assert.equal(polls.filter((ev) => ev.finalStart != null).length, 1);
  // The organizer links work: each token opens its own poll as the organizer.
  const admin = await fetch(`${base}/api/events/${made[0].id}/notifications`, {
    headers: { 'x-admin-token': made[0].adminToken },
  });
  assert.equal(admin.status, 200);
});
