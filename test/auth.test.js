import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { isAppRoute } from '../src/routes.js';

// Sign-in with stand-ins for Google's and GitHub's token endpoints: the server's own fetch is mocked.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`;

let server, baseUrl;
let googleClaims = () => ({});
const exchanged = [];

async function fakeFetch(url, init = {}) {
  const u = String(url);
  if (u === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(init.body);
    exchanged.push(Object.fromEntries(form));
    if (form.get('code') === 'bad') return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: 'at', id_token: idToken(googleClaims(form)) });
  }
  if (u === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gh-at' });
  if (u === 'https://api.github.com/user') return Response.json({ id: 42, login: 'octo', name: null });
  if (u === 'https://api.github.com/user/emails')
    return Response.json([
      { email: 'old@example.com', primary: false, verified: true },
      { email: 'octo@example.com', primary: true, verified: true },
    ]);
  throw new Error(`unexpected fetch ${u}`);
}

before(async () => {
  server = createApp({
    dbPath: ':memory:',
    fetchImpl: fakeFetch,
    env: {
      GOOGLE_CLIENT_ID: 'g-client',
      GOOGLE_CLIENT_SECRET: 'g-secret',
      GITHUB_CLIENT_ID: 'gh-client',
      GITHUB_CLIENT_SECRET: 'gh-secret',
      MICROSOFT_CLIENT_ID: 'ms-client', // no secret: calendars only, no sign-in
    },
  });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, headers = {}, cookie } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...headers },
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

const cookieOf = (res, name) => {
  const c = res.headers.getSetCookie().find((s) => s.startsWith(`${name}=`));
  return c && c.split(';')[0];
};

/** Sign in with Google as `sub`, the whole way round. Returns the session cookie. */
async function signIn(sub = 'g-1', { next = '/me', claims = {}, code = 'ok' } = {}) {
  const start = await call(`/api/auth/google?next=${encodeURIComponent(next)}`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  const flow = cookieOf(start, 'venn_signin');
  googleClaims = () => ({
    iss: 'https://accounts.google.com',
    aud: 'g-client',
    sub,
    email: `${sub}@example.com`,
    email_verified: true,
    name: 'Sam Rivera',
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: to.searchParams.get('nonce'),
    ...claims,
  });
  const back = await call(`/api/auth/google/callback?code=${code}&state=${to.searchParams.get('state')}`, { cookie: flow });
  assert.equal(back.status, 302);
  return { back, session: cookieOf(back, 'venn_session') };
}

const poll = {
  title: 'Book club',
  organizer: 'Sam',
  timezone: 'Europe/London',
  dates: ['2026-11-02', '2026-11-03'],
  startMinute: 0,
  endMinute: 1440,
  slotMinutes: 1440,
  durationMinutes: 1440,
};

test('config lists only the sign-ins with a client ID and a secret', async () => {
  assert.deepEqual((await call('/api/config')).data.accounts, ['google', 'github']);
  assert.equal((await call('/api/auth/microsoft')).status, 404);
  assert.equal((await call('/api/auth/nope')).status, 404);
});

test('starting sign-in: PKCE, state and nonce, and a short-lived cookie for the round trip', async () => {
  const res = await call('/api/auth/google?next=/me');
  const to = new URL(res.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(to.searchParams.get('client_id'), 'g-client');
  assert.equal(to.searchParams.get('redirect_uri'), `${baseUrl}/api/auth/google/callback`);
  assert.equal(to.searchParams.get('scope'), 'openid email profile');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(to.searchParams.get('state') && to.searchParams.get('nonce'));
  const set = res.headers.getSetCookie()[0];
  assert.match(set, /^venn_signin=.+; Path=\/api; Max-Age=600; HttpOnly; SameSite=Lax$/);
});

test('signing in with Google: an account, a session cookie, and the page it started from', async () => {
  const { back, session } = await signIn('g-flow', { next: '/me' });
  assert.equal(back.headers.get('location'), '/me');
  assert.match(
    back.headers.getSetCookie().join('\n'),
    /venn_session=[\w-]{40,}; Path=\/api; Max-Age=2592000; HttpOnly; SameSite=Lax/,
  );
  // The code was swapped with the PKCE verifier and the secret, server to server.
  const sent = exchanged.at(-1);
  assert.equal(sent.client_secret, 'g-secret');
  assert.ok(sent.code_verifier.length >= 43);
  const me = await call('/api/me', { cookie: session });
  assert.deepEqual(me.data.user, {
    name: 'Sam Rivera',
    email: 'g-flow@example.com',
    provider: 'google',
    providerLabel: 'Google',
  });
  assert.deepEqual(me.data.polls, []);
  // Signed out (no cookie, or a made-up one): no one, and the ways to sign in.
  assert.deepEqual((await call('/api/me')).data, { user: null, providers: ['google', 'github'] });
  assert.equal((await call('/api/me', { cookie: 'venn_session=madeup' })).data.user, null);
});

test('sign-in fails safely: wrong state, nonce, audience, issuer, an expired token or a refused code', async () => {
  const start = await call('/api/auth/google');
  const flow = cookieOf(start, 'venn_signin');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  // No cookie, or someone else's state: never signed in.
  for (const [q, cookie] of [
    [`code=ok&state=${state}`, undefined],
    ['code=ok&state=forged', flow],
    [`error=access_denied&state=${state}`, flow],
  ]) {
    const res = await call(`/api/auth/google/callback?${q}`, { cookie });
    assert.equal(res.headers.get('location'), '/me#signin-failed');
    assert.equal(cookieOf(res, 'venn_session'), undefined);
  }
  for (const claims of [
    { nonce: 'other' },
    { aud: 'someone-else' },
    { iss: 'https://evil.example' },
    { exp: Math.floor(Date.now() / 1000) - 10 },
  ]) {
    const { back, session } = await signIn('g-bad', { claims });
    assert.equal(back.headers.get('location'), '/me#signin-failed');
    assert.equal(session, undefined);
  }
  const { back } = await signIn('g-bad', { code: 'bad' });
  assert.equal(back.headers.get('location'), '/me#signin-failed');
});

test('only paths on this site are where sign-in goes back to', async () => {
  for (const next of ['https://evil.example', '//evil.example', '/\\evil', 'javascript:alert(1)']) {
    const { back } = await signIn('g-next', { next });
    assert.equal(back.headers.get('location'), '/me');
  }
  assert.equal((await signIn('g-next', { next: '/e/abc' })).back.headers.get('location'), '/e/abc');
});

test('signing in with GitHub: its id, and its primary verified email', async () => {
  const start = await call('/api/auth/github');
  const to = new URL(start.headers.get('location'));
  assert.equal(to.origin, 'https://github.com');
  assert.equal(to.searchParams.get('nonce'), null);
  const back = await call(`/api/auth/github/callback?code=x&state=${to.searchParams.get('state')}`, {
    cookie: cookieOf(start, 'venn_signin'),
  });
  const me = await call('/api/me', { cookie: cookieOf(back, 'venn_session') });
  assert.deepEqual(me.data.user, { name: 'octo', email: 'octo@example.com', provider: 'github', providerLabel: 'GitHub' });
});

test('my polls: made signed in, or claimed with the organizer link; the owner is the organizer', async () => {
  const { session } = await signIn('g-polls');
  // Made while signed in: kept with the account.
  const made = (await call('/api/events', { method: 'POST', body: poll, cookie: session })).data;
  // Made signed out, on this browser: claimed with its organizer token (a wrong one claims nothing).
  const before = (await call('/api/events', { method: 'POST', body: { ...poll, title: 'Earlier' } })).data;
  const claim = await call('/api/me/claim', {
    method: 'POST',
    cookie: session,
    body: {
      polls: [
        { id: before.id, token: before.adminToken },
        { id: made.id, token: made.adminToken }, // already theirs
        { id: before.id, token: 'wrong' },
        { id: 'nope', token: 'x' },
        { id: '../etc', token: 'x' },
      ],
    },
  });
  assert.deepEqual(claim.data.added, { polls: 1, brands: 0 });
  const listed = (await call('/api/me', { cookie: session })).data.polls;
  assert.deepEqual(listed.map((p) => p.id).sort(), [made.id, before.id].sort());
  assert.equal(listed[0].answers, 0);

  // Their poll, on any device, without its link: the organizer when they ask to be (`x-organizer`),
  // a guest on the plain link, as with the organizer link.
  assert.equal((await call(`/api/events/${before.id}`, { cookie: session })).data.isAdmin, false);
  assert.equal((await call(`/api/events/${before.id}`, { cookie: session, headers: { 'x-organizer': '1' } })).data.isAdmin, true);
  assert.equal((await call(`/api/events/${before.id}/notifications`, { cookie: session })).status, 200);
  // Organizer actions work with the account alone, from this site; never from another one.
  const pick = { start: (await call(`/api/events/${before.id}`)).data.slots[0] };
  assert.equal(
    (
      await call(`/api/events/${before.id}/finalize`, {
        method: 'POST',
        body: pick,
        cookie: session,
        headers: { origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/api/events/${before.id}/finalize`, {
        method: 'POST',
        body: pick,
        cookie: session,
        headers: { 'sec-fetch-site': 'cross-site' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/api/events/${before.id}/finalize`, {
        method: 'POST',
        body: pick,
        cookie: session,
        headers: { origin: baseUrl },
      })
    ).status,
    200,
  );
  assert.equal((await call('/api/me', { cookie: session })).data.polls.find((p) => p.id === before.id).finalStart, pick.start);

  // Someone else signed in: not theirs, and they can't claim it without the link.
  const other = (await signIn('g-other')).session;
  assert.equal((await call(`/api/events/${before.id}`, { cookie: other, headers: { 'x-organizer': '1' } })).data.isAdmin, false);
  assert.equal((await call(`/api/events/${before.id}`, { method: 'DELETE', cookie: other })).status, 403);
  // Even with the link, a poll already kept with an account stays with that one.
  const steal = await call('/api/me/claim', {
    method: 'POST',
    cookie: other,
    body: { polls: [{ id: before.id, token: before.adminToken }] },
  });
  assert.deepEqual(steal.data.added, { polls: 0, brands: 0 });

  // Taken off the list, the poll stays (its link still works); deleted, it leaves the list.
  assert.equal((await call(`/api/me/polls/${made.id}`, { method: 'DELETE', cookie: session })).status, 200);
  assert.equal((await call(`/api/events/${made.id}`, { headers: { 'x-admin-token': made.adminToken } })).data.isAdmin, true);
  assert.equal((await call(`/api/events/${before.id}`, { method: 'DELETE', cookie: session })).status, 200);
  assert.deepEqual((await call('/api/me', { cookie: session })).data.polls, []);
});

test('my brand templates: made signed in or claimed, and managed with the account', async () => {
  const { session } = await signIn('g-brands');
  const made = (await call('/api/brands', { method: 'POST', body: { name: 'Acme' }, cookie: session })).data;
  // Saving a template needs an account here (sign-in is set up); signed out, nothing is made.
  const refused = await call('/api/brands', { method: 'POST', body: { name: 'Beta Co' } });
  assert.equal(refused.status, 401);
  assert.equal(refused.data.error, 'Sign in to save your template');
  // One made with its manage link and on no account (as templates were before accounts) can be claimed.
  const earlier = (await call('/api/brands', { method: 'POST', body: { name: 'Beta Co' }, cookie: session })).data;
  await call(`/api/me/brands/${earlier.id}`, { method: 'DELETE', cookie: session });
  assert.deepEqual(
    (await call('/api/me', { cookie: session })).data.brands.map((b) => b.name),
    ['Acme'],
  );
  // ...and its manage link still changes it, with no account.
  assert.equal(
    (
      await call(`/api/brands/${earlier.id}`, {
        method: 'PUT',
        body: { name: 'Beta Co' },
        headers: { 'x-admin-token': earlier.adminToken },
      })
    ).status,
    200,
  );
  const claim = await call('/api/me/claim', {
    method: 'POST',
    cookie: session,
    body: { brands: [{ id: earlier.id, token: earlier.adminToken }] },
  });
  assert.deepEqual(claim.data.added, { polls: 0, brands: 1 });
  const me = (await call('/api/me', { cookie: session })).data;
  assert.deepEqual(me.brands.map((b) => b.name).sort(), ['Acme', 'Beta Co']);
  assert.equal((await call(`/api/brands/${made.id}`, { cookie: session })).data.isAdmin, false);
  assert.equal((await call(`/api/brands/${made.id}`, { cookie: session, headers: { 'x-organizer': '1' } })).data.isAdmin, true);
  assert.equal(
    (await call(`/api/brands/${made.id}`, { method: 'PUT', body: { name: 'Acme Inc' }, cookie: session })).status,
    200,
  );
  assert.equal((await call(`/api/brands/${made.id}`, { method: 'DELETE', cookie: session })).status, 200);
  assert.deepEqual(
    (await call('/api/me', { cookie: session })).data.brands.map((b) => b.name),
    ['Beta Co'],
  );
});

test('signing out ends the session; deleting the account forgets it and leaves its polls', async () => {
  const { session } = await signIn('g-bye');
  const made = (await call('/api/events', { method: 'POST', body: poll, cookie: session })).data;
  const out = await call('/api/auth/logout', { method: 'POST', cookie: session });
  assert.match(out.headers.getSetCookie()[0], /^venn_session=; Path=\/api; Max-Age=0/);
  assert.equal((await call('/api/me', { cookie: session })).data.user, null);
  assert.equal((await call('/api/me/claim', { method: 'POST', body: {}, cookie: session })).status, 401);

  const again = (await signIn('g-bye')).session;
  assert.equal((await call('/api/me', { cookie: again })).data.polls.length, 1, 'the same account, signing in again');
  assert.equal((await call('/api/me', { method: 'DELETE', cookie: again })).status, 200);
  assert.equal((await call('/api/me', { cookie: again })).data.user, null);
  // Signing in once more makes a new, empty account; the poll is still there, with its link.
  const fresh = (await signIn('g-bye')).session;
  assert.deepEqual((await call('/api/me', { cookie: fresh })).data.polls, []);
  assert.equal((await call(`/api/events/${made.id}`, { headers: { 'x-admin-token': made.adminToken } })).data.isAdmin, true);
});

test('claims are checked: a list, of a sensible size', async () => {
  const { session } = await signIn('g-claims');
  assert.equal((await call('/api/me/claim', { method: 'POST', cookie: session, body: { polls: 'x' } })).status, 400);
  const many = Array.from({ length: 201 }, (_, i) => ({ id: `a${i}`, token: 't' }));
  assert.equal((await call('/api/me/claim', { method: 'POST', cookie: session, body: { polls: many } })).status, 400);
  assert.equal((await call('/api/me/nope', { cookie: session })).status, 404);
  assert.equal((await call('/api/auth/logout')).status, 405);
});

test('/me is a page of the app', () => {
  assert.ok(isAppRoute('/me'));
});

test('My polls: the organizer links this browser remembers, and pasted ones', async () => {
  const { rememberedLinks, parseOrganizerLink, pollMeta, signInButtons } = await import('../public/account-data.js');
  const buttons = signInButtons(['google', 'evil"><script>', 'github'], '/brand');
  assert.match(buttons, /href="\/api\/auth\/google\?next=%2Fbrand"/);
  assert.match(buttons, /Continue with GitHub/);
  assert.doesNotMatch(buttons, /script/);
  const items = {
    'venn:abc123': JSON.stringify({ adminToken: 'tok1', participantId: 'p' }),
    'venn:guestonly': JSON.stringify({ participantId: 'p', editToken: 'e' }),
    'venn:brand:br1': JSON.stringify({ adminToken: 'tok2' }),
    'venn:brands': JSON.stringify([{ id: 'br1', name: 'Acme' }]),
    'venn:retro': '0',
    'venn:name': 'Sam',
    'venn:broken': '{',
    other: JSON.stringify({ adminToken: 'x' }),
  };
  const storage = { length: Object.keys(items).length, key: (i) => Object.keys(items)[i], getItem: (k) => items[k] };
  assert.deepEqual(rememberedLinks(storage), {
    polls: [{ id: 'abc123', token: 'tok1' }],
    brands: [{ id: 'br1', token: 'tok2' }],
  });
  assert.deepEqual(parseOrganizerLink(' https://venn.day/e/abc123#admin=XYZ9 '), { kind: 'polls', id: 'abc123', token: 'XYZ9' });
  assert.deepEqual(parseOrganizerLink('venn.day/brand/br1#admin=t'), { kind: 'brands', id: 'br1', token: 't' });
  assert.equal(parseOrganizerLink('https://venn.day/e/abc123'), null);
  assert.equal(pollMeta({ finalStart: null, answers: 0 }), 'No answers yet');
  assert.equal(pollMeta({ finalStart: null, answers: 1 }), '1 answer');
  assert.equal(pollMeta({ finalStart: null, answers: 3 }), '3 answers');
  assert.match(pollMeta({ finalStart: Date.UTC(2031, 2, 3, 12) }, Date.UTC(2030, 0, 1)), /^Picked: .*3/);
  assert.match(pollMeta({ finalStart: Date.UTC(2020, 2, 3, 12) }, Date.UTC(2030, 0, 1)), /^Was /);
});
