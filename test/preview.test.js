import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';
import worker from '../src/worker.js';
import { appShell, injectTags, pollPreview, previewTags, setLabel } from '../src/preview.js';
import { SECURITY_HEADERS } from '../src/security-headers.js';
import { IF_NEEDED, YES, zonedToUtc } from '../public/core.js';

const SHELL = readFileSync(new URL('../public/app.html', import.meta.url), 'utf8');

/** The content of a <meta> tag, by name or property. */
const meta = (html, key) => new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)" />`).exec(html)?.[1];
const titleOf = (html) => /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];

// A Friday dinner in New York, 7 PM, one hour, in half-hour slots.
const NY = 'America/New_York';
const seven = zonedToUtc('2026-11-13', 1140, NY);
const dinner = {
  title: "Dinner at Rosa's",
  emoji: '🍝',
  organizer: 'Priya',
  timezone: NY,
  dates: ['2026-11-13'],
  startMinute: 1140,
  endMinute: 1260,
  slotMinutes: 30,
  durationMinutes: 60,
};
const half = seven + 30 * 60_000;

// ---------- unit ----------

test('preview: before a date is picked, the poll asks, with the organizer’s name', () => {
  const p = pollPreview({ ...dinner, finalStart: null, answers: [] });
  assert.equal(p.title, "🍝 Dinner at Rosa's");
  assert.equal(p.description, "Priya wants to find a time for Dinner at Rosa's. Fri, Nov 13. Tap when you're free. No sign-up.");
  assert.equal(p.image.path, '/og.png');
  // A poll with its own picture shows that, not its emoji as well.
  assert.equal(pollPreview({ ...dinner, finalStart: null, image: { v: 1, card: true } }).title, "Dinner at Rosa's");
  const anon = pollPreview({ ...dinner, emoji: undefined, organizer: '', finalStart: null });
  assert.equal(anon.title, "Dinner at Rosa's");
  assert.equal(anon.description, "When works for you? Fri, Nov 13. Tap when you're free. No sign-up.");
  // A few dates to vote on: how many, and the days they span.
  const pick = { ...dinner, mode: 'options', options: [{ start: seven }, { start: seven + 2 * 86_400_000 }], finalStart: null };
  assert.equal(
    pollPreview(pick).description,
    "Priya wants to find a time for Dinner at Rosa's. 2 choices, Nov 13 – 15. Tap the ones that work. No sign-up.",
  );
  assert.match(
    pollPreview({ ...dinner, dates: ['2026-11-30', '2026-12-02'], finalStart: null }).description,
    / Nov 30 – Dec 2\. /,
  );
});

test('preview: once it’s set, the date in the poll’s time zone and how many can make it', () => {
  const answers = [
    { [seven]: YES, [half]: YES },
    { [seven]: YES, [half]: IF_NEEDED },
    { [seven]: YES }, // misses the second half hour
  ];
  const p = pollPreview({ ...dinner, finalStart: seven, answers });
  assert.equal(p.description, "It's set: Fri, Nov 13, 7:00 PM EST · 2 of 3 can make it");
  assert.equal(p.image.path, '/og-set.png');
  // No answers yet, or nobody can: no count, or zero.
  assert.equal(pollPreview({ ...dinner, finalStart: seven }).description, "It's set: Fri, Nov 13, 7:00 PM EST");
  assert.match(pollPreview({ ...dinner, finalStart: seven, answers: [{}] }).description, / · 0 of 1 can make it$/);
});

test('preview: hidden results or names never show counts or the organizer’s name', () => {
  const answers = [{ [seven]: YES, [half]: YES }];
  for (const privacy of [{ hideResults: true }, { hideNames: true }]) {
    const set = pollPreview({ ...dinner, ...privacy, finalStart: seven, answers });
    assert.equal(set.description, "It's set: Fri, Nov 13, 7:00 PM EST", JSON.stringify(privacy));
  }
  assert.equal(
    pollPreview({ ...dinner, hideNames: true, finalStart: null }).description,
    "When works for you? Fri, Nov 13. Tap when you're free. No sign-up.",
  );
});

test('preview: whole days and options polls', () => {
  const trip = {
    title: 'Trip',
    timezone: 'Europe/London',
    dates: ['2026-11-13', '2026-11-14', '2026-11-15'],
    slotMinutes: 1440,
    durationMinutes: 1440 * 3,
  };
  const fri = zonedToUtc('2026-11-13', 0, 'Europe/London');
  assert.equal(setLabel(trip, fri), 'Fri, Nov 13 – Sun, Nov 15');
  assert.equal(setLabel({ ...trip, durationMinutes: 1440 }, fri), 'Fri, Nov 13');
  const options = {
    title: 'Lunch',
    mode: 'options',
    timezone: 'Asia/Tokyo',
    options: [{ start: Date.UTC(2026, 10, 13, 3), end: Date.UTC(2026, 10, 13, 4) }],
  };
  const p = pollPreview({
    ...options,
    finalStart: options.options[0].start,
    answers: [{ [options.options[0].start]: IF_NEEDED }, {}],
  });
  assert.equal(p.description, "It's set: Fri, Nov 13, 12:00 PM GMT+9 · 1 of 2 can make it");
});

test('preview tags escape everything people typed', () => {
  const p = pollPreview({ ...dinner, title: '"><script>alert(1)</script>', organizer: "<b>Mal'</b>", finalStart: null });
  const tags = previewTags(p, { origin: 'https://venn.day', url: 'https://venn.day/e/abc' });
  // Nothing typed comes through as markup, in any letter case.
  for (const raw of ['<script', '<b>']) assert.ok(!tags.toLowerCase().includes(raw), raw);
  assert.equal(titleOf(tags), '🍝 &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; · Venn');
  assert.equal(meta(tags, 'og:title'), '🍝 &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(
    meta(tags, 'description'),
    '&lt;b&gt;Mal&#39;&lt;/b&gt; wants to find a time for &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;. Fri, Nov 13. Tap when you&#39;re free. No sign-up.',
  );
  assert.equal(meta(tags, 'og:image'), 'https://venn.day/og.png');
  // A $ in a title isn't a replacement pattern.
  assert.equal(
    titleOf(injectTags(SHELL, previewTags({ ...p, title: "$& $' $1" }, { origin: '', url: '' }))),
    '$&amp; $&#39; $1 · Venn',
  );
});

test('the app shell gets one title and one description, replaced', async () => {
  const store = { getPreview: async () => ({ ...dinner, finalStart: null, answers: [] }) };
  const html = await appShell(SHELL, { pathname: '/e/abc', origin: 'https://venn.day', store });
  assert.equal(html.match(/<title>/g).length, 1);
  assert.equal(html.match(/<meta name="description"/g).length, 1);
  assert.equal(meta(html, 'og:url'), 'https://venn.day/e/abc');
  assert.match(html, /<main id="app">/);
  // Other app routes are left alone, and a failing database falls back to the generic preview.
  assert.equal(await appShell(SHELL, { pathname: '/new', origin: '', store }), SHELL);
  const broken = { getPreview: async () => Promise.reject(new Error('db down')) };
  const errors = [];
  const log = console.error;
  console.error = (e) => errors.push(e);
  try {
    const generic = await appShell(SHELL, { pathname: '/e/abc/', origin: 'https://venn.day', store: broken });
    assert.equal(titleOf(generic), 'Venn: find a time that works');
    assert.equal(meta(generic, 'og:image'), 'https://venn.day/og.png');
  } finally {
    console.error = log;
  }
  assert.equal(errors.length, 1);
});

// ---------- both servers ----------

/** Create a poll, answer it, and optionally pick the date, through `fetchPath`. */
async function makePoll(fetchPath, { pick = false, privacy = {}, title = dinner.title } = {}) {
  const post = async (path, body, headers = {}) =>
    (
      await fetchPath(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    ).json();
  const { id, adminToken } = await post('/api/events', { ...dinner, title, ...privacy });
  for (const name of ['Ann', 'Bob'])
    await post(`/api/events/${id}/participants`, { name, availability: { [seven]: YES, [half]: YES } });
  await post(`/api/events/${id}/participants`, { name: 'Cy', availability: {} });
  if (pick) await post(`/api/events/${id}/finalize`, { start: seven }, { 'x-admin-token': adminToken });
  return id;
}

async function checkServer(fetchPath, origin) {
  const page = async (id) => {
    const res = await fetchPath(`/e/${id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(name), value, name);
    return res.text();
  };

  const asking = await page(await makePoll(fetchPath, { title: 'Book club <i>&</i>' }));
  assert.equal(titleOf(asking), '🍝 Book club &lt;i&gt;&amp;&lt;/i&gt; · Venn');
  assert.equal(meta(asking, 'og:title'), '🍝 Book club &lt;i&gt;&amp;&lt;/i&gt;');
  assert.equal(
    meta(asking, 'og:description'),
    'Priya wants to find a time for Book club &lt;i&gt;&amp;&lt;/i&gt;. Fri, Nov 13. Tap when you&#39;re free. No sign-up.',
  );
  assert.equal(meta(asking, 'og:image'), `${origin}/og.png`);
  assert.equal(meta(asking, 'og:site_name'), 'Venn');
  assert.equal(meta(asking, 'twitter:card'), 'summary_large_image');

  const id = await makePoll(fetchPath, { pick: true });
  const set = await page(id);
  assert.equal(meta(set, 'og:url'), `${origin}/e/${id}`);
  assert.equal(meta(set, 'description'), 'It&#39;s set: Fri, Nov 13, 7:00 PM EST · 2 of 3 can make it');
  assert.equal(meta(set, 'og:image'), `${origin}/og-set.png`);
  assert.equal(meta(set, 'og:image:width'), '1200');
  assert.doesNotMatch(set, /Ann|Bob/);

  for (const privacy of [{ hideResults: true }, { hideNames: true }]) {
    const hidden = await page(await makePoll(fetchPath, { pick: true, privacy }));
    assert.equal(meta(hidden, 'og:description'), 'It&#39;s set: Fri, Nov 13, 7:00 PM EST', JSON.stringify(privacy));
  }

  const unknown = await page('doesnotexist');
  assert.equal(titleOf(unknown), 'Venn: find a time that works');
  assert.equal(meta(unknown, 'og:image'), `${origin}/og.png`);
  assert.equal(meta(unknown, 'og:title'), 'Venn: find the day that works for everyone');
}

let server, baseUrl;
before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('Node server: poll pages carry the poll’s link preview', async () => {
  await checkServer((path, init) => fetch(baseUrl + path, init), baseUrl);
});

/** Cloudflare's D1 API, over node:sqlite. */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  return {
    prepare: (sql) => ({
      bind: (...params) => ({
        run: async () => db.prepare(sql).run(...params),
        all: async () => ({ results: db.prepare(sql).all(...params) }),
        first: async () => db.prepare(sql).get(...params) ?? null,
      }),
    }),
  };
}

test('Worker: poll pages carry the same link preview, without the static ETag', async () => {
  const assetRequests = [];
  const env = {
    DB: fakeD1(),
    ASSETS: {
      fetch: async (req) => {
        assetRequests.push(req);
        const path = new URL(req.url).pathname;
        if (path === '/app')
          return new Response(SHELL, {
            headers: { 'content-type': 'text/html', etag: '"static"', 'cache-control': 'public, max-age=0, must-revalidate' },
          });
        return new Response('Page not found', { status: 404, headers: { 'content-type': 'text/html' } });
      },
    },
  };
  const ctx = { waitUntil: () => {} };
  const origin = 'https://venn.example';
  const fetchPath = (path, init) => worker.fetch(new Request(origin + path, init), env, ctx);
  await checkServer(fetchPath, origin);

  const res = await fetchPath('/e/doesnotexist', { headers: { 'if-none-match': '"static"' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('etag'), null);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(assetRequests.at(-1).headers.get('if-none-match'), null);
  const head = await fetchPath('/e/doesnotexist', { method: 'HEAD' });
  assert.equal(await head.text(), '');
  const missing = await fetchPath('/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-frame-options'), 'DENY');
});
