// A local staging site for trying features before they ship: `npm run staging`.
// Runs Venn on this computer with its own database (data/staging.db, fresh each run; `-- --keep`
// keeps it), filled with polls of every kind, so there's something to click straight away. Phones
// on the same Wi-Fi can open it too, at the address it prints. Nothing is published.

import { rmSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';
import { DAY_PARTS, addDays } from '../public/core.js';

const NAMES = [
  'Ana Lima',
  'Ben Okafor',
  'Cai Chen',
  'Dee Park',
  'Eli Rossi',
  'Fay Martin',
  'Gus Haddad',
  'Hal Cohen',
  'Ivy Shah',
  'Jo Reed',
  'Kim Ortiz',
  'Leo Becker',
];

/** Today's date in a time zone, as YYYY-MM-DD. */
const todayIn = (tz) => new Date().toLocaleDateString('en-CA', { timeZone: tz });

/**
 * Fills a Venn server at `base` with polls of every kind, answered by a few people (by a dozen on
 * one). Returns [{ title, id, adminToken }]. Answers are random but the same on every run.
 */
export async function seed(base, { tz = 'UTC', today = todayIn(tz) } = {}) {
  let n = 7;
  const random = () => (n = (n * 9301 + 49297) % 233280) / 233280;
  const post = async (path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${path}: ${data.error || res.status}`);
    return data;
  };
  const days = (from, count) => Array.from({ length: count }, (_, i) => addDays(today, from + i));
  const at = (date, minutes) => Date.parse(`${date}T00:00:00Z`) + minutes * 60_000; // in UTC, the polls' zone
  const polls = [
    {
      title: 'Book club',
      guests: 4,
      poll: { mode: 'options', options: days(3, 5).map((d) => ({ start: at(d, 1140), end: at(d, 1260) })) },
    },
    {
      title: 'Brunch',
      guests: 3,
      poll: {
        mode: 'options',
        layout: 'parts',
        options: days(2, 3).flatMap((d) => DAY_PARTS.slice(0, 2).map((p) => ({ start: at(d, p.start), end: at(d, p.end) }))),
      },
    },
    {
      title: 'Game night',
      guests: 5,
      poll: { dates: days(1, 14), startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: 1440 },
    },
    {
      title: 'Cabin weekend',
      guests: 4,
      poll: { dates: days(1, 21), startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: 3 * 1440 },
    },
    {
      title: 'Team call',
      guests: 3,
      poll: { windows: days(1, 5).map((date) => ({ date, start: 540, end: 1080 })), slotMinutes: 30, durationMinutes: 60 },
    },
    {
      title: 'Reunion (a big group)',
      guests: 12,
      poll: { windows: days(7, 6).map((date) => ({ date, start: 1080, end: 1320 })), slotMinutes: 30, durationMinutes: 120 },
    },
    {
      title: 'Dinner (the date is set)',
      guests: 4,
      pick: true,
      poll: { mode: 'options', options: days(4, 3).map((d) => ({ start: at(d, 1140), end: at(d, 1260) })) },
    },
  ];
  const made = [];
  for (const { title, guests, pick, poll } of polls) {
    const { id, adminToken } = await post('/api/events', { title, organizer: 'Sam', timezone: 'UTC', ...poll });
    const { slots } = await (await fetch(`${base}/api/events/${id}`)).json();
    for (const name of NAMES.slice(0, guests)) {
      const availability = {};
      for (const s of slots) {
        const r = random();
        if (r < 0.55) availability[s] = 2;
        else if (r < 0.75) availability[s] = 1;
      }
      await post(`/api/events/${id}/participants`, { name, availability });
    }
    if (pick) await post(`/api/events/${id}/finalize`, { start: slots[0] }, { 'x-admin-token': adminToken });
    made.push({ title, id, adminToken });
  }
  return made;
}

/** This computer's addresses on the local network, for opening the site from a phone. */
const lanAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dbPath = process.env.DB_PATH || join(root, 'data', 'staging.db');
  const keep = process.argv.includes('--keep');
  if (!keep) for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
  const port = Number(process.env.PORT || 8788);
  const app = createApp({ dbPath });
  await new Promise((r) => app.listen(port, r));
  const base = `http://localhost:${port}`;
  const polls = keep ? [] : await seed(base);
  // In a GitHub Codespace, the address it's forwarded to (private to you unless made public).
  const { CODESPACE_NAME: cs, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: domain } = process.env;
  const open = cs && domain ? `https://${cs}-${port}.${domain}` : base;
  const width = Math.max(0, ...polls.map((p) => p.title.length));
  console.log(`\nVenn staging is running at ${open}`);
  if (open === base) for (const ip of lanAddresses()) console.log(`  on a phone on the same Wi-Fi: http://${ip}:${port}`);
  if (polls.length) {
    console.log('\nPolls to try (organizer links; open without #admin=… to see a guest):');
    for (const p of polls) console.log(`  ${p.title.padEnd(width)}  ${open}/e/${p.id}#admin=${p.adminToken}`);
  }
  console.log(`\nIts database is ${dbPath}${keep ? '' : ', fresh each run (add -- --keep to keep it)'}. Ctrl+C stops it.\n`);
}
