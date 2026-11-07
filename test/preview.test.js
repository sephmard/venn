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
const HOME = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

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

test('preview: a poll in the retro look shows Venn’s retro images, and its own picture over them', () => {
  assert.equal(pollPreview({ ...dinner, retro: true, finalStart: null }).image.path, '/og-retro.png');
  assert.equal(pollPreview({ ...dinner, retro: true, finalStart: seven }).image.path, '/og-set-retro.png');
  assert.match(
    pollPreview({ ...dinner, retro: true, id: 'abc', finalStart: null, image: { v: 3, card: true } }).image.path,
    /card\.jpg\?v=3$/,
  );
});

test('the app shell: a poll in the retro look comes in it from the first paint; others, and other pages, as they are', async () => {
  const store = (ev) => ({ getPreview: async () => ev && { ...dinner, ...ev, answers: [] } });
  const at = (pathname, ev) => appShell(SHELL, { pathname, origin: 'https://venn.example', store: store(ev) });
  assert.match(await at('/e/abc', { retro: true }), /<html class="retro" lang="en">/);
  assert.match(await at('/e/abc', { retro: false }), /<html lang="en">/);
  assert.match(await at('/e/gone', null), /<html lang="en">/);
  assert.equal(await at('/new', null), SHELL); // a new poll's look is the browser's to pick (app-look.js)
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

test('a template share link previews the template; white label leaves Venn out; others stay as they are', async () => {
  const brands = {
    club: { id: 'club', name: 'Riverside <Book> Club' },
    wl: { id: 'wl', name: 'Acme', hideVenn: true },
  };
  const store = { getBrand: async (id) => brands[id] || null };
  const at = (pathname, search) => appShell(SHELL, { pathname, search, origin: 'https://venn.day', store });

  const club = await at('/new', '?brand=club');
  assert.equal(titleOf(club), 'Make a poll with Riverside &lt;Book&gt; Club · Venn');
  assert.equal(meta(club, 'og:url'), 'https://venn.day/new?brand=club');
  assert.equal(meta(club, 'og:site_name'), 'Venn');
  assert.equal(meta(club, 'og:image'), 'https://venn.day/og-retro.png');
  assert.equal(club.match(/<title>/g).length, 1);

  const wl = await at('/new/topic', '?brand=wl&x=1');
  assert.equal(titleOf(wl), 'Make a poll with Acme');
  assert.equal(meta(wl, 'og:site_name'), 'Acme');
  assert.equal(meta(wl, 'og:url'), 'https://venn.day/new/topic?brand=wl');
  assert.equal(meta(wl, 'og:image'), undefined);
  const said = [
    titleOf(wl),
    ...[...wl.matchAll(/<meta (?:name|property)="(?:description|og:[a-z_]+)" content="([^"]*)"/g)].map((m) => m[1]),
  ];
  assert.doesNotMatch(said.join(' '), /Venn/);

  // No template, "Use no template", a bad id or one that's gone: the shell as it is.
  for (const search of ['', '?brand=none', '?brand=gone', '?brand=../x', '?brand='])
    assert.equal(await at('/new', search), SHELL);
  const broken = { getBrand: async () => Promise.reject(new Error('db down')) };
  const log = console.error;
  console.error = () => {};
  try {
    assert.equal(await appShell(SHELL, { pathname: '/new', search: '?brand=club', origin: '', store: broken }), SHELL);
  } finally {
    console.error = log;
  }
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

/** `home`: this server serves the home page itself (Cloudflare serves it before the Worker runs). */
async function checkServer(fetchPath, origin, { home: servesHome = true } = {}) {
  // The home page previews the retro look, the site's own; /classic is the home page in the
  // classic look, with the classic preview at its own address.
  const home = async (path) => {
    const res = await fetchPath(path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    return res.text();
  };
  const retro = servesHome ? await home('/') : HOME;
  assert.equal(meta(retro, 'og:image'), 'https://venn.day/og-retro.png');
  assert.equal(meta(retro, 'og:url'), 'https://venn.day/');
  const classic = await home('/classic');
  assert.equal(meta(classic, 'og:image'), `${origin}/og.png`);
  assert.equal(meta(classic, 'og:url'), `${origin}/classic`);
  assert.equal(meta(classic, 'og:title'), meta(retro, 'og:title'));
  assert.match(classic, /<link rel="canonical" href="https:\/\/venn\.day\/"/); // one page, two looks

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
  assert.equal(meta(unknown, 'og:title'), 'Venn: find the day that works');
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
      sql,
      bind: (...params) => ({
        run: async () => db.prepare(sql).run(...params),
        all: async () => ({ results: db.prepare(sql).all(...params) }),
        first: async () => db.prepare(sql).get(...params) ?? null,
      }),
    }),
    batch: async (stmts) => stmts.map((st) => db.prepare(st.sql).run()),
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
        if (path === '/') return new Response(HOME, { headers: { 'content-type': 'text/html', etag: '"home"' } });
        if (path === '/app')
          return new Response(SHELL, {
            headers: {
              'content-type': 'text/html',
              etag: '"static"',
              'cache-control': 'public, max-age=0, must-revalidate',
              'x-frame-options': 'SAMEORIGIN', // as public/_headers adds
            },
          });
        return new Response('Page not found', { status: 404, headers: { 'content-type': 'text/html' } });
      },
    },
  };
  const ctx = { waitUntil: () => {} };
  const origin = 'https://venn.example';
  const fetchPath = (path, init) => worker.fetch(new Request(origin + path, init), env, ctx);
  await checkServer(fetchPath, origin, { home: false });

  const res = await fetchPath('/e/doesnotexist', { headers: { 'if-none-match': '"static"' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('etag'), null);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(assetRequests.at(-1).headers.get('if-none-match'), null);
  const head = await fetchPath('/e/doesnotexist', { method: 'HEAD' });
  assert.equal(await head.text(), '');
  // /classic is always fresh, never the home page's bodiless 304.
  const classic = await fetchPath('/classic', { headers: { 'if-none-match': '"home"' } });
  assert.equal(classic.status, 200);
  assert.equal(classic.headers.get('etag'), null);
  assert.equal(classic.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(assetRequests.at(-1).headers.get('if-none-match'), null);
  const missing = await fetchPath('/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-frame-options'), 'SAMEORIGIN');

  // A template's websites may frame its polls' embed pages (src/embed.js), whatever the static headers say.
  const post = (path, body) =>
    fetchPath(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) =>
      r.json(),
    );
  const brand = await post('/api/brands', { name: 'Acme', embedSites: ['https://acme.com'] });
  const poll = await post('/api/events', { ...dinner, dates: ['2026-11-02'], brand: brand.id });
  const embed = await fetchPath(`/embed/${poll.id}`);
  assert.equal(embed.status, 200);
  assert.match(embed.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/acme\.com$/);
  assert.equal(embed.headers.get('x-frame-options'), null);
  assert.match(await embed.text(), /<html class="embed"/);
  assert.equal((await fetchPath(`/e/${poll.id}`)).headers.get('x-frame-options'), 'SAMEORIGIN');
});

test('Worker: the hourly run sends what deadlines have due, and nothing when none are', async () => {
  const waiting = [];
  await worker.scheduled({ scheduledTime: Date.now() }, { DB: fakeD1() }, { waitUntil: (p) => waiting.push(p) });
  assert.equal(waiting.length, 1);
  assert.equal(await waiting[0], 0);
});

test("Worker: when making a page fails, Venn's own page instead of Cloudflare's error", async () => {
  let failures = 0;
  const env = {
    DB: fakeD1(),
    ASSETS: {
      fetch: async (req) => {
        if (failures > 0) {
          failures--;
          throw new Error('assets unavailable');
        }
        const path = new URL(req.url).pathname;
        if (path === '/app') return new Response(SHELL, { headers: { 'content-type': 'text/html' } });
        return new Response(HOME, { headers: { 'content-type': 'text/html' } });
      },
    },
  };
  const fetchPath = (path, init) => worker.fetch(new Request('https://venn.example' + path, init), env, { waitUntil: () => {} });
  const logged = [];
  const log = console.error;
  console.error = (...a) => logged.push(a.map(String).join(' '));
  try {
    // The first try fails, the plain app still loads the poll by itself.
    failures = 1;
    const poll = await fetchPath('/e/abc');
    assert.equal(poll.status, 200);
    assert.equal(await poll.text(), SHELL);
    assert.equal(poll.headers.get('cache-control'), 'no-store');
    assert.equal(poll.headers.get('content-security-policy'), SECURITY_HEADERS['content-security-policy']);
    // Nothing to fall back on: a short page saying to try again, with the security headers.
    failures = 2;
    const home = await fetchPath('/classic');
    assert.equal(home.status, 503);
    const page = await home.text();
    assert.match(page, /Try again in a minute/);
    assert.doesNotMatch(page, /Venn/); // it also shows on white-label and embedded polls
    assert.match(page, /color-scheme" content="light dark"/);
    assert.equal(home.headers.get('x-frame-options'), 'SAMEORIGIN');
    failures = 1;
    const missing = await fetchPath('/nope', { method: 'HEAD' });
    assert.equal(missing.status, 503);
    assert.equal(await missing.text(), '');
  } finally {
    console.error = log;
  }
  assert.ok(logged.some((l) => l.startsWith('page failed /e/abc')));
  assert.ok(logged.some((l) => l.startsWith('fallback page failed')));
  // And once the assets are back, pages are made as before.
  assert.equal((await fetchPath('/nope')).status, 404);
});

test("a white-label poll's tab shows its template's logo, not Venn's icon", async () => {
  const polls = {
    a: { id: 'a', title: 'Hike', brand: 'wl' },
    b: { id: 'b', title: 'Hike', brand: 'nologo' },
    c: { id: 'c', title: 'Hike', brand: 'club' },
  };
  const brands = {
    wl: { id: 'wl', name: 'Acme', hideVenn: true, logoV: 7 },
    nologo: { id: 'nologo', name: 'Acme', hideVenn: true, logoV: null },
    club: { id: 'club', name: 'Club', logoV: 3 },
  };
  const store = { getPreview: async (id) => polls[id] || null, getBrand: async (id) => brands[id] || null };
  const at = (id) => appShell(SHELL, { pathname: `/e/${id}`, origin: 'https://venn.day', store });
  const icons = (html) => [...html.matchAll(/<link rel="icon"[^>]*>/g)].map((m) => m[0]);

  assert.deepEqual(icons(await at('a')), ['<link rel="icon" href="/api/brands/wl/logo?v=7" />']);
  // No logo, or not white label: Venn's icons, as they are.
  assert.deepEqual(icons(await at('b')), icons(SHELL));
  assert.deepEqual(icons(await at('c')), icons(SHELL));
});
