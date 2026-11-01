import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { FONTS, brandCss, contrast, palette, scheme } from '../public/brand-look.js';
import { normalizeBrand, publicBrand } from '../src/brands.js';
import { isAppRoute } from '../src/routes.js';

// A 1 × 1 PNG, and something that only says it's one.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const NOT_PNG = btoa('<svg onload="alert(1)"></svg>');

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
  return { status: res.status, data, headers: res.headers };
}

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

test('palette: any colour reads at 4.5:1 on Venn’s backgrounds, light and dark, with readable ink', () => {
  for (const hex of ['#ffcc00', '#ffffff', '#000000', '#6d28d9', '#0b7a5c', '#ff0000', '#00ffff', '#777777']) {
    const p = palette(hex);
    for (const bg of ['#faf8f4', '#ffffff', '#f2eee6']) assert.ok(contrast(p.light.accent, bg) >= 4.5, `${hex} light on ${bg}`);
    for (const bg of ['#0f1112', '#171a1c', '#1f2326']) assert.ok(contrast(p.dark.accent, bg) >= 4.5, `${hex} dark on ${bg}`);
    for (const m of [p.light, p.dark]) assert.ok(contrast(m.accent, m.ink) >= 4.5, `${hex}: ink on accent`);
  }
  // A colour that already reads well is kept as it is.
  assert.equal(palette('#0b7a5c').light.accent, '#0b7a5c');
});

test('scheme: an organization’s own page colours stay readable, whatever they are', () => {
  const get = (vars, k) => vars.match(new RegExp(`--${k}:(#[0-9a-f]{6})`))[1];
  const cases = [
    { bg: '#ffffff', surface: '#f4f4f5', text: '#cccccc', accent: '#ffff00' }, // pale text and accent
    { bg: '#101820', surface: '#ffffff', text: '#333333', accent: '#000080' }, // a light card on a dark page
    { bg: '#777777' }, // the middle
    { bg: '#fff4e6', surface: '#ffffff', text: '#3d2c1e', accent: '#e8590c' },
  ];
  for (const c of cases) {
    const { vars } = scheme(c);
    const backs = ['bg', 'surface', 'surface-2'].map((k) => get(vars, k));
    for (const k of ['text', 'muted', 'accent'])
      for (const b of backs) assert.ok(contrast(get(vars, k), b) >= 4.5, `${JSON.stringify(c)}: ${k} on ${b}`);
    assert.ok(contrast(get(vars, 'accent'), get(vars, 'accent-ink')) >= 4.5);
  }
  // Colours that already read well are kept.
  const own = scheme(cases[3]).vars;
  assert.match(own, /--bg:#fff4e6;--surface:#ffffff;/);
  assert.match(own, /--text:#3d2c1e;/);
});

test('brandCss: only computed colours and known fonts reach the page', () => {
  const css = brandCss({ accent: '#6d28d9', font: 'serif' });
  assert.match(css, /--accent:#[0-9a-f]{6};/);
  assert.ok(css.includes(FONTS.serif[1]));
  assert.match(css, /prefers-color-scheme: dark/);
  // Anything else is left out, so Venn's own look stays.
  const plain = brandCss({ accent: 'red;}body{display:none', font: '__proto__' });
  assert.doesNotMatch(plain, /--accent|--display|display:none/);
});

test('normalizeBrand: keeps only what is set, and refuses what isn’t right', () => {
  assert.deepEqual(
    normalizeBrand({ name: 'A', bg: '#000000', surface: '#111111', text: '#EEEEEE', bodyFont: 'slab', corners: 'round' }),
    { name: 'A', bg: '#000000', surface: '#111111', text: '#eeeeee', bodyFont: 'slab', corners: 'round' },
  );
  // Cards and text go with a background of its own.
  assert.deepEqual(normalizeBrand({ name: 'A', surface: '#111111', text: '#eeeeee' }), { name: 'A' });
  assert.throws(() => normalizeBrand({ name: 'A', corners: 'wavy' }), /Unknown corners/);
  assert.throws(() => normalizeBrand({ name: 'A', bodyFont: 'comic' }), /Unknown font/);
  assert.deepEqual(normalizeBrand({ name: '  Acme  ', accent: '#AABBCC', font: 'mono', title: '', where: 'HQ', extra: 1 }), {
    name: 'Acme',
    accent: '#aabbcc',
    font: 'mono',
    where: 'HQ',
  });
  assert.throws(() => normalizeBrand({ name: '' }), /Organization name is required/);
  assert.throws(() => normalizeBrand({ name: 'A', accent: 'red' }), /Colours must look like/);
  assert.throws(() => normalizeBrand({ name: 'A', font: 'comic' }), /Unknown font/);
  assert.throws(() => normalizeBrand({ name: 'x'.repeat(61) }), /at most 60/);
  assert.throws(() => normalizeBrand({ name: 'A', emoji: 'nope' }), /Invalid emoji/);
  assert.deepEqual(publicBrand({ id: 'b1', name: 'A', adminHash: 'secret', logoV: null }), { id: 'b1', name: 'A', logo: null });
});

test('/brand and /brand/<id> are pages of the app', () => {
  assert.ok(isAppRoute('/brand'));
  assert.ok(isAppRoute('/brand/abc123'));
  assert.ok(!isAppRoute('/brand/../x'));
});

test('brand templates: make, share, manage, logo, polls in its look, delete', async () => {
  const made = await call('/api/brands', {
    method: 'POST',
    body: { name: 'Acme', accent: '#6d28d9', font: 'serif', title: 'Lunch' },
  });
  assert.equal(made.status, 201);
  const { id, adminToken } = made.data;
  const admin = { 'x-admin-token': adminToken };

  // Anyone with the share link sees the look, never the hash; only the manage link manages it.
  const seen = await call(`/api/brands/${id}`);
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.data, { id, name: 'Acme', accent: '#6d28d9', font: 'serif', title: 'Lunch', logo: null, isAdmin: false });
  assert.equal((await call(`/api/brands/${id}`, { headers: admin })).data.isAdmin, true);
  assert.equal((await call(`/api/brands/${id}`, { method: 'PUT', body: { name: 'Evil' } })).status, 403);
  assert.equal(
    (await call(`/api/brands/${id}`, { method: 'PUT', body: { name: 'X' }, headers: { 'x-admin-token': 'wrong' } })).status,
    403,
  );
  assert.equal((await call(`/api/brands/${id}/logo`, { method: 'PUT', body: { logo: PNG } })).status, 403);
  assert.equal((await call(`/api/brands/${id}`, { method: 'DELETE' })).status, 403);

  const changed = await call(`/api/brands/${id}`, {
    method: 'PUT',
    body: { name: 'Acme Inc.', accent: '#ffcc00' },
    headers: admin,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.name, 'Acme Inc.');
  assert.equal(changed.data.font, undefined);

  // The logo: a real picture only, served as one, versioned.
  assert.equal((await call(`/api/brands/${id}/logo`, { method: 'PUT', body: { logo: NOT_PNG }, headers: admin })).status, 400);
  const up = await call(`/api/brands/${id}/logo`, {
    method: 'PUT',
    body: { logo: `data:image/png;base64,${PNG}` },
    headers: admin,
  });
  assert.equal(up.status, 200);
  assert.match(up.data.logo, new RegExp(`^/api/brands/${id}/logo\\?v=\\d+$`));
  const img = await fetch(baseUrl + up.data.logo);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control'), /immutable/);
  assert.match(img.headers.get('content-security-policy'), /sandbox/);

  // A poll made from it shows its look to guests; the retro look gives way to it.
  const created = await call('/api/events', { method: 'POST', body: { ...poll, brand: id, retro: true } });
  assert.equal(created.status, 201);
  const ev = (await call(`/api/events/${created.data.id}`)).data;
  assert.deepEqual(ev.brand, { id, name: 'Acme Inc.', accent: '#ffcc00', logo: up.data.logo });
  assert.equal(ev.retro, undefined);
  // Editing the poll keeps its brand.
  const edit = await call(`/api/events/${created.data.id}`, {
    method: 'PUT',
    body: { ...poll, title: 'Lunch!' },
    headers: { 'x-admin-token': created.data.adminToken },
  });
  assert.equal(edit.status, 200);
  assert.equal((await call(`/api/events/${created.data.id}`)).data.brand.id, id);

  // No such template, no poll.
  assert.equal((await call('/api/events', { method: 'POST', body: { ...poll, brand: 'nope' } })).status, 400);
  assert.equal((await call('/api/events', { method: 'POST', body: { ...poll, brand: '../x' } })).status, 400);

  // Without its logo, and then deleted: its polls go back to Venn's look.
  assert.equal((await call(`/api/brands/${id}/logo`, { method: 'DELETE', headers: admin })).data.logo, null);
  assert.equal((await fetch(`${baseUrl}/api/brands/${id}/logo`)).status, 404);
  assert.equal((await call(`/api/brands/${id}`, { method: 'DELETE', headers: admin })).status, 200);
  assert.equal((await call(`/api/brands/${id}`)).status, 404);
  assert.equal((await call(`/api/events/${created.data.id}`)).data.brand, undefined);
});
