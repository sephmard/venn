// Default templates for signed-in accounts (src/defaults.js), and the site's own address in links
// (src/site.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleApi } from '../src/api.js';
import { createStore, sqliteAdapter } from '../src/store.js';
import { canonicalRedirect, publicOrigin, siteOrigin } from '../src/site.js';

const sha256 = async (t) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

function setup(env = {}) {
  const store = createStore(sqliteAdapter(new DatabaseSync(':memory:')));
  const call = async (path, { method = 'GET', body, cookie, headers = {}, host = 'https://venn.day' } = {}) => {
    const res = await handleApi(
      new Request(`${host}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...headers },
        body: body && JSON.stringify(body),
      }),
      store,
      { env, clientIp: '127.0.0.1' },
    );
    return { status: res.status, data: await res.json() };
  };
  /** A signed-in account: its id and its cookie. */
  const account = async (sub) => {
    const user = await store.upsertUser({
      provider: 'google',
      subject: sub,
      email: `${sub}@example.com`,
      name: sub,
      now: Date.now(),
    });
    const token = `tok-${sub}-${'x'.repeat(40)}`;
    await store.createSession({
      hash: await sha256(token),
      userId: user.id,
      now: Date.now(),
      expiresAt: Date.now() + 86_400_000,
    });
    return { id: user.id, cookie: `venn_session=${token}` };
  };
  /** A brand template kept with `owner`'s account. */
  const template = async (owner, name) => {
    const { data } = await call('/api/brands', { method: 'POST', body: { name }, cookie: owner.cookie });
    assert.ok(data.id, JSON.stringify(data));
    return data.id;
  };
  return { store, call, account, template };
}

test('an account sets, reads, changes and clears a default template for each kind of poll', async () => {
  const { call, account, template } = setup();
  const ana = await account('ana');
  const club = await template(ana, 'Book club');
  const team = await template(ana, 'Team');
  const put = (body) => call('/api/me/defaults', { method: 'PUT', body, cookie: ana.cookie });

  assert.deepEqual((await call('/api/me/defaults', { cookie: ana.cookie })).data, { defaults: { date: null, vote: null } });
  assert.deepEqual((await put({ format: 'date', template: club })).data.defaults, {
    date: { id: club, name: 'Book club' },
    vote: null,
  });
  await put({ format: 'vote', template: team });
  await put({ format: 'date', template: team }); // changed
  // GET /api/me carries them too, so the create page needs one request.
  assert.deepEqual((await call('/api/me', { cookie: ana.cookie })).data.defaults, {
    date: { id: team, name: 'Team' },
    vote: { id: team, name: 'Team' },
  });
  assert.deepEqual((await put({ format: 'vote', template: null })).data.defaults, {
    date: { id: team, name: 'Team' },
    vote: null,
  });

  // Asking wrongly, or signed out.
  assert.equal((await put({ format: 'trip', template: club })).status, 400);
  assert.equal((await put({ format: 'date', template: 'not/an id' })).status, 400);
  assert.equal((await put({ format: 'date', template: 42 })).status, 400);
  assert.equal((await call('/api/me/defaults', { method: 'PUT', body: { format: 'date', template: club } })).status, 401);
  assert.equal((await call('/api/me/defaults')).status, 401);
  assert.equal((await call('/api/me', {})).data.defaults, undefined);
  assert.equal((await call('/api/me/defaults', { method: 'DELETE', cookie: ana.cookie })).status, 405);
  // From another website: treated as signed out (src/auth.js), so it can't change anyone's default.
  const cross = await call('/api/me/defaults', {
    method: 'PUT',
    body: { format: 'date', template: club },
    cookie: ana.cookie,
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(cross.status, 401);
});

test('only a template in the account can be its default: owned, or given by invite, never just a share link', async () => {
  const { store, call, account, template } = setup();
  const ana = await account('ana');
  const ben = await account('ben');
  const anas = await template(ana, 'Ana’s club');
  const put = (who, body) => call('/api/me/defaults', { method: 'PUT', body, cookie: who.cookie });

  // Ben knows the share link (/new?brand=…) but doesn't have the template.
  const refused = await put(ben, { format: 'date', template: anas });
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /in your account/);
  assert.equal((await put(ben, { format: 'date', template: 'NoSuchTemplate' })).status, 403);

  // Given it (an invite link's role), Ben can.
  await store.setBrandMember(anas, ben.id, 'user', Date.now());
  assert.equal((await put(ben, { format: 'date', template: anas })).status, 200);
});

test('a default that breaks is cleared when read: template deleted, left, taken away, or the account deleted', async () => {
  const { store, call, account, template } = setup();
  const ana = await account('ana');
  const ben = await account('ben');
  const read = async (who) => (await call('/api/me/defaults', { cookie: who.cookie })).data.defaults;
  const put = (who, body) => call('/api/me/defaults', { method: 'PUT', body, cookie: who.cookie });

  // Taken away: Ben is removed from Ana's template.
  const shared = await template(ana, 'Shared');
  await store.setBrandMember(shared, ben.id, 'user', Date.now());
  await put(ben, { format: 'vote', template: shared });
  await store.removeBrandMember(shared, ben.id);
  assert.deepEqual(await read(ben), { date: null, vote: null });

  // Left from My polls (DELETE /api/me/brands/:id).
  await store.setBrandMember(shared, ben.id, 'user', Date.now());
  await put(ben, { format: 'vote', template: shared });
  await call(`/api/me/brands/${shared}`, { method: 'DELETE', cookie: ben.cookie });
  assert.deepEqual(await read(ben), { date: null, vote: null });

  // Deleted: gone for everyone who had it as a default.
  const gone = await template(ana, 'Gone');
  await put(ana, { format: 'date', template: gone });
  await store.deleteBrand(gone);
  assert.deepEqual(await read(ana), { date: null, vote: null });

  // A row the server can't stand behind any more (here: the membership vanished without the usual
  // cleanup) is repaired on read, not shown.
  const other = await template(ana, 'Other');
  await store.setBrandMember(other, ben.id, 'admin', Date.now());
  await put(ben, { format: 'date', template: other });
  await store.setDefault(ben.id, 'date', other, Date.now());
  await store.setBrandMember(other, ben.id, 'user', Date.now()); // still has it: kept
  assert.deepEqual((await read(ben)).date, { id: other, name: 'Other' });
  await store.setDefault(ben.id, 'vote', 'Ghost123', Date.now()); // never existed
  assert.equal((await read(ben)).vote, null);
  assert.deepEqual(await store.listDefaults(ben.id), [{ format: 'date', brandId: other }]);

  // Account deleted: its defaults go with it.
  await call('/api/me', { method: 'DELETE', cookie: ben.cookie });
  assert.deepEqual(await store.listDefaults(ben.id), []);
});

test('the site’s own address: PUBLIC_URL when set, else the request’s; other addresses move to it', () => {
  assert.equal(publicOrigin({}), null);
  assert.equal(publicOrigin({ PUBLIC_URL: 'https://venn.day/' }), 'https://venn.day');
  assert.equal(publicOrigin({ PUBLIC_URL: 'http://localhost:8787' }), 'http://localhost:8787');
  assert.equal(publicOrigin({ PUBLIC_URL: 'http://venn.day' }), null); // plain http only on this machine
  assert.equal(publicOrigin({ PUBLIC_URL: 'https://user:pw@venn.day' }), null);
  assert.equal(publicOrigin({ PUBLIC_URL: 'not a url' }), null);
  assert.equal(siteOrigin({}, 'https://venn.acct.workers.dev/e/x'), 'https://venn.acct.workers.dev');
  assert.equal(siteOrigin({ PUBLIC_URL: 'https://venn.day' }, 'https://venn.acct.workers.dev/e/x'), 'https://venn.day');

  const env = { PUBLIC_URL: 'https://venn.day' };
  const at = (u, method = 'GET') => canonicalRedirect(new Request(u, { method }), env);
  const moved = at('https://venn.acct.workers.dev/new?brand=Acme1');
  assert.equal(moved.status, 307);
  assert.equal(moved.headers.get('location'), 'https://venn.day/new?brand=Acme1');
  assert.equal(at('https://venn.day/new'), null);
  assert.equal(at('http://localhost:8787/new'), null);
  assert.equal(at('https://venn.acct.workers.dev/api/events'), null); // the API answers where it's asked
  assert.equal(at('https://venn.acct.workers.dev/new', 'POST'), null);
  assert.equal(canonicalRedirect(new Request('https://venn.acct.workers.dev/new'), {}), null);
});

test('links the server writes use PUBLIC_URL, wherever the request came in', async () => {
  const { call } = setup({ PUBLIC_URL: 'https://venn.day' });
  const made = await call('/api/events', {
    method: 'POST',
    host: 'https://venn.acct.workers.dev',
    body: { title: 'Plans', timezone: 'UTC', mode: 'topic', options: ['A', 'B'] },
  });
  assert.equal(made.status, 201);
  assert.equal(made.data.url, `https://venn.day/e/${made.data.id}`);
  assert.ok(made.data.adminUrl.startsWith(`https://venn.day/e/${made.data.id}#admin=`));
  // Without PUBLIC_URL (local, self-hosted), the request's own address, as before.
  const local = await setup().call('/api/events', {
    method: 'POST',
    host: 'http://localhost:8787',
    body: { title: 'Plans', timezone: 'UTC', mode: 'topic', options: ['A', 'B'] },
  });
  assert.equal(local.data.url, `http://localhost:8787/e/${local.data.id}`);
});
