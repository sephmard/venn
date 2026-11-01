import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { frameHeaders, normalizeSite, normalizeSites, MAX_EMBED_SITES } from '../src/embed.js';
import { normalizeBrand, publicBrand } from '../src/brands.js';
import { isAppRoute } from '../src/routes.js';
import { SECURITY_HEADERS } from '../src/security-headers.js';

let server, baseUrl;
before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, headers: res.headers };
};

const poll = {
  title: 'Team lunch',
  organizer: 'Sam',
  timezone: 'Europe/London',
  dates: ['2026-11-02'],
  startMinute: 0,
  endMinute: 1440,
  slotMinutes: 1440,
  durationMinutes: 1440,
};

test('websites: kept as their origin, https only (http just for localhost), no pages or wildcards', () => {
  assert.equal(normalizeSite('https://Acme.com/'), 'https://acme.com');
  assert.equal(normalizeSite('acme.com'), 'https://acme.com');
  assert.equal(normalizeSite(' https://app.acme.com:8443 '), 'https://app.acme.com:8443');
  assert.equal(normalizeSite('http://localhost:3000'), 'http://localhost:3000');
  for (const bad of [
    'http://acme.com',
    'https://acme.com/polls',
    'https://acme.com/?a=1',
    'https://user:pw@acme.com',
    'https://*.acme.com',
    'javascript:alert(1)',
    'ftp://acme.com',
    "https://acme.com 'unsafe-inline'",
    'not a site',
    42,
  ])
    assert.throws(() => normalizeSite(bad), /address|website/i, String(bad));
  assert.deepEqual(normalizeSites(['acme.com', 'https://acme.com', '', 'https://b.org']), ['https://acme.com', 'https://b.org']);
  assert.deepEqual(normalizeSites(undefined), []);
  assert.throws(() => normalizeSites('https://acme.com'), /list/);
  const many = Array.from({ length: MAX_EMBED_SITES + 1 }, (_, i) => `https://s${i}.com`);
  assert.throws(() => normalizeSites(many), /At most/);
});

test('frame headers: only Venn frames Venn, unless a template lists its websites', () => {
  assert.deepEqual(frameHeaders(), SECURITY_HEADERS);
  assert.deepEqual(frameHeaders([]), SECURITY_HEADERS);
  const h = frameHeaders(['https://acme.com', 'https://b.org']);
  assert.match(h['content-security-policy'], /frame-ancestors 'self' https:\/\/acme\.com https:\/\/b\.org$/);
  assert.equal(h['x-frame-options'], undefined);
  // The rest of the policy stays as it is.
  assert.match(h['content-security-policy'], /script-src 'self';/);
  assert.equal(SECURITY_HEADERS['x-frame-options'], 'SAMEORIGIN');
});

test('brand templates: hide Venn and the websites that may embed, kept and shown to anyone with a link', () => {
  const b = normalizeBrand({ name: 'Acme', hideVenn: true, embedSites: ['acme.com'] });
  assert.deepEqual(b, { name: 'Acme', hideVenn: true, embedSites: ['https://acme.com'] });
  assert.deepEqual(normalizeBrand({ name: 'Acme', hideVenn: false, embedSites: [] }), { name: 'Acme' });
  assert.throws(() => normalizeBrand({ name: 'Acme', hideVenn: 'yes' }), /hideVenn/);
  const pub = publicBrand({ id: 'x', ...b });
  assert.equal(pub.hideVenn, true);
  assert.deepEqual(pub.embedSites, ['https://acme.com']);
  assert.equal(publicBrand({ id: 'x', name: 'Acme' }).embedSites, undefined);
});

test('/embed/<poll> is an app route', () => {
  assert.ok(isAppRoute('/embed/abc123'));
  assert.ok(!isAppRoute('/embed'));
  assert.ok(!isAppRoute('/embed/a/b'));
});

test('Node server: a template’s websites may frame its polls’ embed pages, and nothing else', async () => {
  const made = await call('/api/brands', {
    method: 'POST',
    body: { name: 'Acme', embedSites: ['https://acme.com'], hideVenn: true },
  });
  assert.equal(made.status, 201);
  const { id: brand, adminToken } = made.data;
  const ev = await call('/api/events', { method: 'POST', body: { ...poll, brand, retro: true } });
  const id = ev.data.id;
  const embed = await fetch(`${baseUrl}/embed/${id}`);
  assert.equal(embed.status, 200);
  assert.match(embed.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/acme\.com$/);
  assert.equal(embed.headers.get('x-frame-options'), null);
  const html = await embed.text();
  // The poll alone, without Venn's name, from the first paint; the brand's look replaces retro.
  assert.match(html, /<html class="embed white-label"/);
  assert.match(html, /<title>Team lunch<\/title>/);
  assert.match(html, /og:site_name" content="Acme"/);
  assert.doesNotMatch(html, /og\.png/);
  // The poll's own page is still Venn's alone to frame.
  const page = await fetch(`${baseUrl}/e/${id}`);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'$/);
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(await page.text(), /<html class="white-label"/);
  // GET returns the template's sites, for the frame's messages to the website around it.
  assert.deepEqual((await call(`/api/events/${id}`)).data.brand.embedSites, ['https://acme.com']);

  // The manage link changes the list; a bad website is refused.
  const put = (body) => call(`/api/brands/${brand}`, { method: 'PUT', body, headers: { 'x-admin-token': adminToken } });
  assert.equal((await put({ name: 'Acme', embedSites: ['https://acme.com/polls'] })).status, 400);
  assert.equal((await put({ name: 'Acme', embedSites: ['https://acme.com'] }, {})).status, 200);
  assert.equal(
    (await call(`/api/brands/${brand}`, { method: 'PUT', body: { name: 'Acme', embedSites: ['https://evil.com'] } })).status,
    403,
  );
  // No websites: nobody else may frame it; and it shows Venn again.
  assert.equal((await put({ name: 'Acme' })).status, 200);
  const closed = await fetch(`${baseUrl}/embed/${id}`);
  assert.match(closed.headers.get('content-security-policy'), /frame-ancestors 'self'$/);
  assert.equal(closed.headers.get('x-frame-options'), 'SAMEORIGIN');
  const shell = await closed.text();
  assert.match(shell, /<html class="embed"/);
  assert.match(shell, /<title>Team lunch · Venn<\/title>/);
});

test('Node server: polls without a template, and unknown polls, can’t be framed by other websites', async () => {
  const ev = await call('/api/events', { method: 'POST', body: poll });
  for (const path of [`/embed/${ev.data.id}`, '/embed/nopoll']) {
    const res = await fetch(baseUrl + path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'$/);
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  }
});
