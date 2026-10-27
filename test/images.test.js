import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.js';
import worker from '../src/worker.js';
import { IMAGE_LIMITS, imageType, parseImage } from '../src/images.js';
import { normalizeEventInput } from '../src/validate.js';
import { firstEmoji, isEmoji } from '../public/emoji.js';
import { buildIcs } from '../public/calendar-export.js';
import { pollPreview } from '../src/preview.js';
import { SECURITY_HEADERS } from '../src/security-headers.js';

// ui.js looks up the page's elements when it loads; a stand-in document is enough here.
globalThis.document ??= { getElementById: () => null };
const { drawCard, layoutCard } = await import('../public/share-card.js');
const { CARD, PREVIEW_STICKERS, drawPreview, iconOf, layoutPreview, stickerButtons, stickerPicture } =
  await import('../public/poll-image.js');

// Just enough of each kind of picture for its first bytes to say what it is.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(40, 2)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
const b64 = (buf) => buf.toString('base64');
const dataUrl = (buf, type = 'image/jpeg') => `data:${type};base64,${b64(buf)}`;

// ---------- unit ----------

test('images: the first bytes say what a picture is: JPEG, PNG or WebP, nothing else', () => {
  assert.equal(imageType(JPEG), 'image/jpeg');
  assert.equal(imageType(PNG), 'image/png');
  assert.equal(imageType(WEBP), 'image/webp');
  assert.equal(imageType(GIF), null);
  assert.equal(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(imageType(Buffer.from('RIFFxxxxAVI ')), null);
  assert.equal(imageType(new Uint8Array()), null);
});

test('images: uploads are base64 or data: URLs, checked by their bytes and their size', () => {
  assert.deepEqual(parseImage(b64(JPEG), 'icon'), { data: b64(JPEG), type: 'image/jpeg' });
  assert.deepEqual(parseImage(dataUrl(PNG, 'image/png'), 'card'), { data: b64(PNG), type: 'image/png' });
  // What it says it is doesn't matter: its bytes do.
  assert.equal(parseImage(dataUrl(WEBP, 'image/jpeg'), 'icon').type, 'image/webp');
  assert.throws(() => parseImage(dataUrl(GIF, 'image/gif'), 'icon'), /JPEG, PNG or WebP/);
  assert.throws(() => parseImage(b64(Buffer.from('<html><script>alert(1)</script></html>')), 'icon'), /JPEG, PNG or WebP/);
  for (const bad of [undefined, null, '', 5, {}]) assert.throws(() => parseImage(bad, 'icon'), /missing/);
  for (const bad of ['not base64!', 'abc', '====', `${b64(JPEG)}\n`])
    assert.throws(() => parseImage(bad, 'icon'), /isn't a picture/);
  const big = (n) => b64(Buffer.concat([JPEG, Buffer.alloc(n - JPEG.length)]));
  assert.equal(parseImage(big(IMAGE_LIMITS.icon), 'icon').type, 'image/jpeg');
  assert.throws(() => parseImage(big(IMAGE_LIMITS.icon + 1), 'icon'), /too big \(at most 200 KB\)/);
  assert.throws(() => parseImage(big(IMAGE_LIMITS.icon * 3), 'icon'), /too big/);
  assert.equal(parseImage(big(IMAGE_LIMITS.card), 'card').type, 'image/jpeg');
  assert.throws(() => parseImage(big(IMAGE_LIMITS.card + 3), 'card'), /preview picture is too big \(at most 300 KB\)/);
});

test('emoji: any one emoji, flags and families included; never letters, digits or markup', () => {
  for (const ok of ['🍝', '🎂', '✈️', '🇯🇵', '🧑‍🤝‍🧑', '👩🏽‍💻', '🏳️‍🌈', '❤️']) assert.ok(isEmoji(ok), ok);
  for (const bad of ['', 'a', 'hi', '1', '#', '1️⃣', '<b>', '🍝🍻', '🍝 ', ' 🍝', '🍝a', '&amp;', 5, null, '🍝'.repeat(9)])
    assert.equal(isEmoji(bad), false, String(bad));
  assert.equal(firstEmoji('🎂 party!'), '🎂');
  assert.equal(firstEmoji('  🇫🇷🇮🇹'), '🇫🇷');
  assert.equal(firstEmoji('cake 🎂'), '');
  assert.equal(firstEmoji(undefined), '');

  const base = { title: 'Cake', timezone: 'UTC', dates: ['2026-11-02'], startMinute: 600, endMinute: 660, slotMinutes: 60 };
  assert.equal(normalizeEventInput({ ...base, emoji: '🎂' }).emoji, '🎂');
  assert.equal('emoji' in normalizeEventInput({ ...base, emoji: '' }), false);
  for (const bad of ['🎂🍰', '<img src=x>', 'cake']) assert.throws(() => normalizeEventInput({ ...base, emoji: bad }), /emoji/);
});

test('calendar: a poll’s picture is the event’s badge (RFC 7986), and the link stays in the description', () => {
  const info = {
    id: 'abc',
    title: 'Dinner',
    start: Date.UTC(2026, 10, 13, 19),
    end: Date.UTC(2026, 10, 13, 21),
    url: 'https://venn.day/e/abc',
  };
  const ics = buildIcs({ ...info, image: { url: 'https://venn.day/api/events/abc/icon.jpg?v=5', type: 'image/jpeg' } });
  assert.match(
    ics,
    /\r\nIMAGE;VALUE=URI;DISPLAY=BADGE;FMTTYPE=image\/jpeg:https:\/\/venn\.day\/api\/events\/abc\/icon\.jpg\?v=5\r\n/,
  );
  assert.match(ics, /\r\nDESCRIPTION:https:\/\/venn\.day\/e\/abc\r\n/);
  assert.match(buildIcs({ ...info, image: { url: 'https://x/i.jpg' } }), /FMTTYPE=image\/jpeg:https:\/\/x\/i\.jpg/);
  assert.doesNotMatch(buildIcs(info), /IMAGE/);
});

test('preview: a poll with its own card shows it, at a URL that changes with the picture', () => {
  const ev = { id: 'abc', title: 'Dinner', timezone: 'UTC', finalStart: null, image: { v: 42, card: true } };
  assert.deepEqual(pollPreview(ev).image, { path: '/api/events/abc/card.jpg?v=42', alt: 'Dinner' });
  // Picked dates show it too, instead of Venn's "It's set".
  const set = {
    ...ev,
    dates: ['2026-11-13'],
    startMinute: 0,
    endMinute: 1440,
    slotMinutes: 1440,
    durationMinutes: 1440,
    finalStart: Date.UTC(2026, 10, 13),
  };
  assert.equal(pollPreview(set).image.path, '/api/events/abc/card.jpg?v=42');
  // An icon with no card, or no picture: Venn's own.
  assert.equal(pollPreview({ ...ev, image: { v: 42, card: false } }).image.path, '/og.png');
  assert.equal(pollPreview({ ...ev, image: undefined }).image.path, '/og.png');
});

// A stand-in for canvas text measuring: every character is half the font size wide.
const measure = (text, font) => Array.from(text).length * +/(\d+(?:\.\d+)?)px/.exec(font)[1] * 0.5;

test('pictures: the link-preview card keeps the name clear of the picture, and the picture on the card', () => {
  for (const title of ['Dinner', "Book club at Priya and Marcus's new place on the hill", 'x'.repeat(400)]) {
    const L = layoutPreview(measure, title);
    assert.equal(L.width, CARD.width);
    assert.equal(L.height, CARD.height);
    assert.ok(L.tile.x + L.tile.size <= CARD.width && L.tile.y >= 0 && L.tile.y + L.tile.size <= CARD.height);
    assert.ok(L.title.lines.length >= 1 && L.title.lines.length <= 3, title);
    for (const l of L.title.lines) assert.ok(l.x + measure(l.text, L.title.font) <= L.tile.x, l.text);
    assert.ok(L.line.y < CARD.height - 40);
  }
  // The "It's set" picture puts the poll's picture where the emoji goes, a little bigger.
  const withEmoji = layoutCard(measure, { title: 'Dinner', when: 'Sat', emoji: '🍝' }).sticker;
  const withPicture = layoutCard(measure, { title: 'Dinner', when: 'Sat', emoji: '🍝', picture: true }).sticker;
  assert.equal(withEmoji.picture, false);
  assert.equal(withPicture.picture, true);
  assert.ok(withPicture.size > withEmoji.size);
  assert.ok(layoutCard(measure, { title: 'Dinner', when: 'Sat', picture: true }).sticker);
});

// ---------- the API ----------

let server, baseUrl;
before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body && (raw ? body : JSON.stringify(body)),
  });
  if (method === 'HEAD' || /\.jpg/.test(path))
    return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
  return { status: res.status, data: await res.json() };
}

const poll = {
  title: 'Cake',
  organizer: 'Sam',
  timezone: 'Europe/London',
  dates: ['2026-11-02'],
  startMinute: 600,
  endMinute: 720,
  slotMinutes: 30,
  durationMinutes: 60,
  emoji: '🎂',
};

async function newPoll(extra = {}) {
  const { data } = await call('/api/events', { method: 'POST', body: { ...poll, ...extra } });
  return { id: data.id, admin: { 'x-admin-token': data.adminToken } };
}

test('API: only the organizer can add, change or remove a poll’s picture', async () => {
  const { id, admin } = await newPoll();
  const body = { icon: dataUrl(JPEG), card: b64(PNG) };
  assert.equal((await call(`/api/events/${id}/image`, { method: 'PUT', body })).status, 403);
  assert.equal(
    (await call(`/api/events/${id}/image`, { method: 'PUT', body, headers: { 'x-admin-token': 'nope' } })).status,
    403,
  );
  assert.equal((await call(`/api/events/${id}/image`, { method: 'DELETE' })).status, 403);
  assert.equal((await call(`/api/events/${id}/image`, { method: 'POST', body, headers: admin })).status, 405);
  assert.equal((await call(`/api/events/nope/image`, { method: 'PUT', body, headers: admin })).status, 404);
  assert.equal((await call(`/api/events/${id}`)).data.image, undefined);
  assert.equal((await call(`/api/events/${id}/icon.jpg`)).status, 404);

  // Not JSON, not a picture, too big: refused, and nothing is stored.
  const form = await call(`/api/events/${id}/image`, {
    method: 'PUT',
    body: 'icon=x',
    raw: true,
    headers: { ...admin, 'content-type': 'text/plain' },
  });
  assert.equal(form.status, 400);
  assert.equal((await call(`/api/events/${id}/image`, { method: 'PUT', body: { icon: b64(GIF) }, headers: admin })).status, 400);
  const huge = { icon: dataUrl(Buffer.concat([JPEG, Buffer.alloc(IMAGE_LIMITS.icon)])) };
  const tooBig = await call(`/api/events/${id}/image`, { method: 'PUT', body: huge, headers: admin });
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.data.error, /too big/);
  const whole = { icon: 'A'.repeat(1_000_000) };
  assert.match((await call(`/api/events/${id}/image`, { method: 'PUT', body: whole, headers: admin })).data.error, /too large/);
  assert.equal((await call(`/api/events/${id}`)).data.image, undefined);

  const saved = await call(`/api/events/${id}/image`, { method: 'PUT', body, headers: admin });
  assert.equal(saved.status, 200);
  const { v } = saved.data.image;
  assert.deepEqual(saved.data.image, { v, card: true, type: 'image/jpeg' });
  assert.deepEqual((await call(`/api/events/${id}`)).data.image, { v, card: true, type: 'image/jpeg' });

  // Served as itself, never as a page.
  const icon = await call(`/api/events/${id}/icon.jpg?v=${v}`);
  assert.equal(icon.status, 200);
  assert.deepEqual(icon.bytes, JPEG);
  assert.equal(icon.headers.get('content-type'), 'image/jpeg');
  assert.equal(icon.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(icon.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(icon.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(icon.headers.get('referrer-policy'), SECURITY_HEADERS['referrer-policy']);
  // Without its version (or an old one), it's checked each time.
  assert.equal((await call(`/api/events/${id}/icon.jpg`)).headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal((await call(`/api/events/${id}/icon.jpg?v=1`)).headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  const card = await call(`/api/events/${id}/card.jpg?v=${v}`);
  assert.equal(card.headers.get('content-type'), 'image/png');
  assert.deepEqual(card.bytes, PNG);
  const head = await call(`/api/events/${id}/card.jpg?v=${v}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.bytes.length, 0);
  assert.equal(head.headers.get('content-length'), String(PNG.length));

  // A new picture is a new version, even within the same millisecond; without a card there's none.
  const next = await call(`/api/events/${id}/image`, { method: 'PUT', body: { icon: b64(WEBP) }, headers: admin });
  assert.ok(next.data.image.v > v);
  assert.deepEqual(next.data.image, { v: next.data.image.v, card: false, type: 'image/webp' });
  assert.equal((await call(`/api/events/${id}/card.jpg`)).status, 404);
  assert.equal((await call(`/api/events/${id}/icon.jpg`)).headers.get('content-type'), 'image/webp');

  const removed = await call(`/api/events/${id}/image`, { method: 'DELETE', headers: admin });
  assert.deepEqual(removed.data, { image: null });
  assert.equal((await call(`/api/events/${id}`)).data.image, undefined);
  assert.equal((await call(`/api/events/${id}/icon.jpg`)).status, 404);
});

test('API: the picture stays apart from the poll’s settings, and goes when the poll is deleted', async () => {
  const { id, admin } = await newPoll();
  const { v } = (
    await call(`/api/events/${id}/image`, { method: 'PUT', body: { icon: b64(JPEG), card: b64(JPEG) }, headers: admin })
  ).data.image;

  // Editing the poll, its privacy, and the organizer's first answer all keep it.
  assert.equal(
    (await call(`/api/events/${id}`, { method: 'PUT', body: { ...poll, title: 'Cake!', emoji: '🍰' }, headers: admin })).status,
    200,
  );
  assert.equal(
    (await call(`/api/events/${id}/settings`, { method: 'PUT', body: { hideNames: true }, headers: admin })).status,
    200,
  );
  assert.equal(
    (await call(`/api/events/${id}/participants`, { method: 'POST', body: { name: 'Sam', availability: {} }, headers: admin }))
      .status,
    201,
  );
  const ev = (await call(`/api/events/${id}`, { headers: admin })).data;
  assert.equal(ev.title, 'Cake!');
  assert.equal(ev.emoji, '🍰');
  assert.deepEqual(ev.image, { v, card: true, type: 'image/jpeg' });

  // The calendar file shows it.
  const final = (await call(`/api/events/${id}/finalize`, { method: 'POST', body: { start: ev.slots[0] }, headers: admin }))
    .status;
  assert.equal(final, 200);
  const ics = await (await fetch(`${baseUrl}/api/events/${id}/event.ics`)).text();
  assert.ok(
    ics.includes(`\r\nIMAGE;VALUE=URI;DISPLAY=BADGE;FMTTYPE=image/jpeg:${baseUrl}/api/events/${id}/icon.jpg?v=${v}\r\n`),
    ics,
  );
  assert.ok(ics.includes(`${baseUrl}/e/${id}`));

  // Its link preview shows its card.
  const html = await (await fetch(`${baseUrl}/e/${id}`)).text();
  assert.ok(html.includes(`<meta property="og:image" content="${baseUrl}/api/events/${id}/card.jpg?v=${v}" />`), html);

  assert.equal((await call(`/api/events/${id}`, { method: 'DELETE', headers: admin })).status, 200);
  assert.equal((await call(`/api/events/${id}/icon.jpg?v=${v}`)).status, 404);
  assert.equal((await call(`/api/events/${id}/card.jpg?v=${v}`)).status, 404);
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

test('Worker: pictures are stored in D1 and served the same way', async () => {
  const env = {
    DB: fakeD1(),
    ASSETS: { fetch: async () => new Response('<title>Venn</title>', { headers: { 'content-type': 'text/html' } }) },
  };
  const origin = 'https://venn.example';
  const go = (path, { method = 'GET', body, headers = {} } = {}) =>
    worker.fetch(
      new Request(origin + path, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body && JSON.stringify(body),
      }),
      env,
      { waitUntil: () => {} },
    );
  const { id, adminToken } = await (await go('/api/events', { method: 'POST', body: poll })).json();
  const admin = { 'x-admin-token': adminToken };
  assert.equal((await go(`/api/events/${id}/image`, { method: 'PUT', body: { icon: b64(JPEG) } })).status, 403);
  const { image } = await (
    await go(`/api/events/${id}/image`, { method: 'PUT', body: { icon: b64(JPEG), card: b64(JPEG) }, headers: admin })
  ).json();
  const icon = await go(`/api/events/${id}/icon.jpg?v=${image.v}`);
  assert.equal(icon.headers.get('content-type'), 'image/jpeg');
  assert.equal(icon.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(Buffer.from(await icon.arrayBuffer()), JPEG);
  const html = await (await go(`/e/${id}`)).text();
  assert.ok(html.includes(`content="${origin}/api/events/${id}/card.jpg?v=${image.v}"`), html);
  assert.equal((await go(`/api/events/${id}`, { method: 'DELETE', headers: admin })).status, 200);
  assert.equal((await go(`/api/events/${id}/card.jpg`)).status, 404);
});

/** A 2D context that records what's drawn. */
function fakeContext() {
  const calls = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(
    {},
    {
      get(target, k) {
        if (k in target) return target[k];
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradient;
        return (...args) => calls.push([k, ...args]);
      },
    },
  );
  return { ctx, calls, texts: () => calls.filter((c) => c[0] === 'fillText').map((c) => c[1]) };
}

test('pictures: the card draws Venn’s name, the poll’s name, a line about Venn, and the picture', () => {
  const { ctx, calls, texts } = fakeContext();
  const picture = { fake: true };
  drawPreview(ctx, layoutPreview(measure, 'Dinner at Rosa’s'), picture); // two lines
  assert.deepEqual(texts(), ['Venn', 'Dinner at', 'Rosa’s', 'Find the day that works for everyone.']);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'drawImage').map((c) => c[1]),
    [picture],
  );
  // A Finn sticker the organizer chose goes on after the picture, over its corner.
  const finn = fakeContext();
  const sticker = { sticker: true };
  drawPreview(finn.ctx, layoutPreview(measure, 'Dinner'), picture, sticker);
  assert.deepEqual(
    finn.calls.filter((c) => c[0] === 'drawImage').map((c) => c[1]),
    [picture, sticker],
  );
  // The "It's set" picture sticks the poll's picture on instead of its emoji.
  const set = fakeContext();
  drawCard(set.ctx, layoutCard(measure, { title: 'Dinner', when: 'Sat', emoji: '🍝', picture: true }), { picture });
  assert.ok(!set.texts().includes('🍝'));
  assert.deepEqual(
    set.calls.filter((c) => c[0] === 'drawImage').map((c) => c[1]),
    [picture],
  );
});

test('pictures: Finn stickers for a poll still asking, and none unless one is chosen', async () => {
  const keys = PREVIEW_STICKERS.map((x) => x.key);
  assert.ok(keys.length >= 4);
  assert.ok(!keys.includes('its-set')); // that one's for once the date is picked
  for (const key of ['', undefined, 'its-set', 'no-such-sticker']) assert.equal(await stickerPicture(key), null, String(key));
  // The choices: "No Finn" first, and only the chosen one pressed.
  const html = stickerButtons('im-in');
  assert.match(html, /^<button type="button" class="pill" data-sticker="" aria-pressed="false">No Finn<\/button>/);
  assert.equal(html.match(/aria-pressed="true"/g).length, 1);
  assert.match(html, /data-sticker="im-in" aria-pressed="true">I’m in</);
  assert.match(stickerButtons(), /data-sticker="" aria-pressed="true">No Finn/);
});

test('images: a poll’s icon is its picture or an emoji, never both', () => {
  const picture = { url: 'data:image/jpeg;base64,AAAA' };
  // A picture replaces the emoji typed for it, and the panel says how to get an emoji back.
  const pic = iconOf({ picture, emoji: '🎂', base: '🍝' });
  assert.equal(pic.picture, picture);
  assert.equal(pic.emoji, '');
  assert.equal(pic.text, '');
  assert.equal(pic.hint, 'Your picture is the icon. Remove it to use an emoji instead.');
  // Without one: the emoji typed, else the kind of plan's, else the calendar.
  assert.deepEqual([iconOf({ emoji: '🎂', base: '🍝' }).text, iconOf({ base: '🍝' }).text, iconOf().text], ['🎂', '🍝', '🗓️']);
  assert.equal(iconOf({ emoji: '🎂' }).emoji, '🎂');
  assert.match(iconOf().hint, /^Or use a picture of your own/);
});
