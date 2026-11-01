import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../server.js';
import { PASSWORD_MIN, breachCount, checkPasswordRules, hashPassword, needsRehash, verifyPassword } from '../src/password.js';
import { LOCK_AFTER, LINKS_PER_HOUR, allowAuthRequest, loginEmail } from '../src/email-auth.js';

// Signing in with an email and a password: the server's email (Resend) and the breach check
// (Have I Been Pwned) are stand-ins, and Google's sign-in too, for connecting it in settings.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`;
const sha1 = (s) => createHash('sha1').update(s).digest('hex').toUpperCase();
const LEAKED = 'correct horse battery';

let server, baseUrl;
const inbox = [];
let pwnedDown = false;

async function fakeFetch(url, init = {}) {
  const u = String(url);
  if (u === 'https://api.resend.com/emails') {
    inbox.push(JSON.parse(init.body));
    return Response.json({ id: 'x' });
  }
  if (u.startsWith('https://api.pwnedpasswords.com/range/')) {
    if (pwnedDown) throw new Error('offline');
    const prefix = u.slice(-5);
    const leaked = sha1(LEAKED);
    const lines = ['0018A45C4D1DEF81644B54AB7F969B88D65:0'];
    if (leaked.startsWith(prefix)) lines.push(`${leaked.slice(5)}:4123`);
    return new Response(lines.join('\r\n'));
  }
  if (u === 'https://oauth2.googleapis.com/token') {
    return Response.json({ access_token: 'at', id_token: idToken(googleClaims) });
  }
  throw new Error(`unexpected fetch ${u}`);
}
let googleClaims = {};

before(async () => {
  server = createApp({
    dbPath: ':memory:',
    fetchImpl: fakeFetch,
    env: {
      EMAIL_FROM: 'Venn <hi@venn.test>',
      RESEND_API_KEY: 're_test',
      GOOGLE_CLIENT_ID: 'g-client',
      GOOGLE_CLIENT_SECRET: 'g-secret',
      AUTH_RATE_LIMIT: '10000',
    },
  });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
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
const post = (path, body, cookie) => call(path, { method: 'POST', body, cookie });
const cookieOf = (res, name = 'venn_session') => {
  const c = res.headers.getSetCookie().find((s) => s.startsWith(`${name}=`));
  return c && c.split(';')[0];
};

/** The emails sent since `n`, and the link's secret in the last one to `to`. */
const settle = () => new Promise((r) => setTimeout(r, 20));
async function lastLink(to) {
  await settle();
  const mail = inbox.filter((m) => m.to[0] === to).at(-1);
  assert.ok(mail, `an email to ${to}`);
  const m = mail.text.match(/(\/me\/\w+)#t=([\w-]{43})/);
  return m && { path: m[1], token: m[2], mail };
}

async function signUp(email, password = 'tangerine-kayak-41') {
  const res = await post('/api/auth/email/signup', { email, password });
  assert.equal(res.status, 200);
  const { token } = await lastLink(email);
  const done = await post('/api/auth/email/confirm', { token });
  assert.equal(done.status, 200);
  return cookieOf(done);
}

// ---------- passwords ----------

test('passwords: PBKDF2 hashes that name their settings, checked in constant time', async () => {
  const h = await hashPassword('tangerine-kayak-41');
  assert.match(h, /^pbkdf2-sha256\$100000\$[\w+/=]{24}\$[\w+/=]{44}$/);
  assert.notEqual(h, await hashPassword('tangerine-kayak-41')); // salted
  assert.equal(await verifyPassword('tangerine-kayak-41', h), true);
  assert.equal(await verifyPassword('tangerine-kayak-42', h), false);
  assert.equal(await verifyPassword('x', 'nonsense'), false);
  // Composed accents are the same password, however they were typed.
  assert.equal(await verifyPassword('café-au-lait-9', await hashPassword('café-au-lait-9')), true);
  const weak = await hashPassword('tangerine-kayak-41', { iterations: 1000 });
  assert.equal(await verifyPassword('tangerine-kayak-41', weak), true);
  assert.equal(needsRehash(weak), true);
  assert.equal(needsRehash(h), false);
});

test('password rules: long enough, not the email, nothing obvious', () => {
  assert.throws(() => checkPasswordRules('short'), new RegExp(`at least ${PASSWORD_MIN}`));
  assert.throws(() => checkPasswordRules('a'.repeat(129)), /at most 128/);
  assert.throws(() => checkPasswordRules('aaaaaaaaaaaa'), /too easy/);
  assert.throws(() => checkPasswordRules('password123'), /too easy/);
  assert.throws(() => checkPasswordRules('sam.rivera@example.com', { email: 'sam.rivera@example.com' }), /email/);
  assert.equal(checkPasswordRules('purple monkey dishwasher'), 'purple monkey dishwasher');
  // No "must contain a symbol" rules: spaces and emoji are fine.
  assert.equal(checkPasswordRules('🐶🐶 walks in the park'), '🐶🐶 walks in the park');
});

test('the breach check sends only 5 characters of a SHA-1, and lets passwords through when it can’t run', async () => {
  const seen = [];
  const fetchImpl = async (u, init) => {
    seen.push({ u, padding: init.headers['add-padding'] });
    return fakeFetch(u, init);
  };
  assert.equal(await breachCount(LEAKED, { fetchImpl }), 4123);
  assert.equal(await breachCount('not in any breach 8812', { fetchImpl }), 0);
  assert.equal(seen[0].u, `https://api.pwnedpasswords.com/range/${sha1(LEAKED).slice(0, 5)}`);
  assert.equal(seen[0].padding, 'true');
  pwnedDown = true;
  assert.equal(await breachCount(LEAKED, { fetchImpl }), null);
  pwnedDown = false;
  assert.equal(await breachCount(LEAKED, { fetchImpl, env: { PWNED_PASSWORDS: 'off' } }), null);
});

test('logins are emails, lowercased', () => {
  assert.equal(loginEmail('  Sam@Example.COM '), 'sam@example.com');
  assert.throws(() => loginEmail('sam'), /email/);
  assert.throws(() => loginEmail(''), /Enter your email/);
});

test('the per-address limit lets a burst through, then says no', async () => {
  const windows = new Map();
  const env = { AUTH_RATE_LIMIT: '2' };
  assert.equal(await allowAuthRequest(env, '1.2.3.4', 0, windows), true);
  assert.equal(await allowAuthRequest(env, '1.2.3.4', 1, windows), true);
  assert.equal(await allowAuthRequest(env, '1.2.3.4', 2, windows), false);
  assert.equal(await allowAuthRequest(env, '5.6.7.8', 2, windows), true);
  assert.equal(await allowAuthRequest(env, '1.2.3.4', 11 * 60_000, windows), true);
});

// ---------- signing up and in ----------

test('config offers email sign-in when the server sends email', async () => {
  assert.deepEqual((await call('/api/config')).data.accounts, ['google', 'email']);
});

test('signing up: a confirmation link first, then the account, signed in', async () => {
  const res = await post('/api/auth/email/signup', { email: 'Ana@Example.com', password: 'tangerine-kayak-41' });
  assert.deepEqual(res.data, { ok: true, email: 'ana@example.com' });
  assert.equal(cookieOf(res), undefined); // no account yet
  // Not before the address is confirmed.
  assert.equal((await post('/api/auth/email/login', { email: 'ana@example.com', password: 'tangerine-kayak-41' })).status, 401);
  const { path, token, mail } = await lastLink('ana@example.com');
  assert.equal(path, '/me/confirm');
  assert.equal(mail.subject, 'Confirm your email for Venn');
  assert.match(mail.html, /Confirm my email/);
  const done = await post('/api/auth/email/confirm', { token });
  assert.equal(done.status, 200);
  const session = cookieOf(done);
  assert.ok(session);
  const me = await call('/api/me', { cookie: session });
  assert.equal(me.data.user.email, 'ana@example.com');
  assert.equal(me.data.user.provider, 'email');
  // A link works once.
  assert.equal((await post('/api/auth/email/confirm', { token })).status, 410);
  // And now the password signs in.
  const login = await post('/api/auth/email/login', { email: 'ANA@example.com', password: 'tangerine-kayak-41' });
  assert.equal(login.status, 200);
  assert.ok(cookieOf(login));
});

test('signing up with leaked or weak passwords is refused, before anything is sent', async () => {
  const before = inbox.length;
  const leaked = await post('/api/auth/email/signup', { email: 'leak@example.com', password: LEAKED });
  assert.equal(leaked.status, 400);
  assert.match(leaked.data.error, /data breach/);
  assert.equal((await post('/api/auth/email/signup', { email: 'leak@example.com', password: 'short' })).status, 400);
  await settle();
  assert.equal(inbox.length, before);
});

test('signing up again never says the address has an account: the email does', async () => {
  await signUp('bo@example.com');
  const again = await post('/api/auth/email/signup', { email: 'bo@example.com', password: 'another-thing-77' });
  assert.deepEqual(again.data, { ok: true, email: 'bo@example.com' });
  const { path, mail } = await lastLink('bo@example.com');
  assert.equal(path, '/me/reset');
  assert.equal(mail.subject, 'You already have a Venn account');
  // The old password still works; the new one wasn't set.
  assert.equal((await post('/api/auth/email/login', { email: 'bo@example.com', password: 'tangerine-kayak-41' })).status, 200);
  assert.equal((await post('/api/auth/email/login', { email: 'bo@example.com', password: 'another-thing-77' })).status, 401);
});

test('wrong passwords: one message whether or not the account exists, then a pause', async () => {
  await signUp('cy@example.com');
  const none = await post('/api/auth/email/login', { email: 'nobody@example.com', password: 'whatever-it-is' });
  const wrong = await post('/api/auth/email/login', { email: 'cy@example.com', password: 'whatever-it-is' });
  assert.equal(none.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(none.data.error, wrong.data.error);
  for (let i = 1; i < LOCK_AFTER; i++)
    await post('/api/auth/email/login', { email: 'cy@example.com', password: 'whatever-it-is' });
  const locked = await post('/api/auth/email/login', { email: 'cy@example.com', password: 'tangerine-kayak-41' });
  assert.equal(locked.status, 429);
  assert.match(locked.data.error, /Try again in 15 minutes/);
});

test('at most a few links an hour to any one address', async () => {
  const email = 'flood@example.com';
  for (let i = 0; i < LINKS_PER_HOUR + 2; i++) assert.equal((await post('/api/auth/email/forgot', { email })).status, 200); // no account: nothing sent
  for (let i = 0; i < LINKS_PER_HOUR + 2; i++) await post('/api/auth/email/signup', { email, password: 'tangerine-kayak-41' });
  await settle();
  assert.equal(inbox.filter((m) => m.to[0] === email).length, LINKS_PER_HOUR);
});

// ---------- forgotten passwords ----------

test('a forgotten password: the same answer for anyone, a link for the owner, everyone signed out', async () => {
  const session = await signUp('di@example.com');
  const before = inbox.length;
  assert.deepEqual((await post('/api/auth/email/forgot', { email: 'nobody@example.com' })).data, {
    ok: true,
    email: 'nobody@example.com',
  });
  await settle();
  assert.equal(inbox.length, before);
  assert.deepEqual((await post('/api/auth/email/forgot', { email: 'di@example.com' })).data, {
    ok: true,
    email: 'di@example.com',
  });
  const { path, token, mail } = await lastLink('di@example.com');
  assert.equal(path, '/me/reset');
  assert.equal(mail.subject, 'Reset your Venn password');
  assert.deepEqual((await post('/api/auth/email/check', { token, kind: 'reset' })).data, {
    ok: true,
    email: 'di@example.com',
    hasPassword: true,
  });
  // A password that isn't allowed doesn't use up the link.
  assert.equal((await post('/api/auth/email/reset', { token, password: LEAKED })).status, 400);
  const done = await post('/api/auth/email/reset', { token, password: 'new-and-improved-9' });
  assert.deepEqual(done.data, { ok: true, email: 'di@example.com' });
  assert.equal(cookieOf(done), undefined); // sign in again, with the new password
  assert.deepEqual((await call('/api/me', { cookie: session })).data.user, null);
  assert.equal((await post('/api/auth/email/reset', { token, password: 'new-and-improved-9' })).status, 410);
  assert.equal((await post('/api/auth/email/login', { email: 'di@example.com', password: 'new-and-improved-9' })).status, 200);
  await settle();
  assert.equal(inbox.at(-1).subject, 'Your Venn password was changed');
});

test('links must be whole', async () => {
  assert.equal((await post('/api/auth/email/confirm', { token: 'abc' })).status, 400);
  assert.equal((await post('/api/auth/email/confirm', { token: 'a'.repeat(43) })).status, 410);
  assert.equal((await call('/api/auth/email/confirm')).status, 405);
  assert.equal((await post('/api/auth/email/nope', {})).status, 404);
});

// ---------- signed in ----------

test('changing the password: the current one first, and other browsers are signed out', async () => {
  const here = await signUp('ed@example.com');
  const there = cookieOf(await post('/api/auth/email/login', { email: 'ed@example.com', password: 'tangerine-kayak-41' }));
  assert.equal((await call('/api/me/settings', { cookie: here })).data.otherSessions, 1);
  assert.equal((await post('/api/me/password', { current: 'nope', password: 'brand-new-secret-5' }, here)).status, 403);
  assert.equal(
    (await post('/api/me/password', { current: 'tangerine-kayak-41', password: 'brand-new-secret-5' }, here)).status,
    200,
  );
  assert.ok((await call('/api/me', { cookie: here })).data.user);
  assert.equal((await call('/api/me', { cookie: there })).data.user, null);
  assert.equal((await call('/api/me/settings', { cookie: here })).data.otherSessions, 0);
  assert.equal((await post('/api/auth/email/login', { email: 'ed@example.com', password: 'brand-new-secret-5' })).status, 200);
});

test('sign out everywhere else', async () => {
  const here = await signUp('fay@example.com');
  const there = cookieOf(await post('/api/auth/email/login', { email: 'fay@example.com', password: 'tangerine-kayak-41' }));
  assert.equal((await post('/api/me/sessions/others', {}, here)).status, 200);
  assert.ok((await call('/api/me', { cookie: here })).data.user);
  assert.equal((await call('/api/me', { cookie: there })).data.user, null);
  assert.equal((await post('/api/me/sessions/others', {})).status, 401);
});

test('changing the email: the password, then a link to the new address; the old one is told', async () => {
  const here = await signUp('gil@example.com');
  assert.equal((await post('/api/me/email', { email: 'gil2@example.com', password: 'nope' }, here)).status, 403);
  assert.equal((await post('/api/me/email', { email: 'gil2@example.com', password: 'tangerine-kayak-41' }, here)).status, 200);
  const { path, token } = await lastLink('gil2@example.com');
  assert.equal(path, '/me/email');
  // Nothing changes until the link is used.
  assert.equal((await call('/api/me/settings', { cookie: here })).data.login, 'gil@example.com');
  assert.deepEqual((await post('/api/auth/email/change', { token })).data, { ok: true, email: 'gil2@example.com' });
  const settings = (await call('/api/me/settings', { cookie: here })).data;
  assert.equal(settings.login, 'gil2@example.com');
  assert.equal(settings.user.email, 'gil2@example.com');
  await settle();
  const told = inbox.filter((m) => m.to[0] === 'gil@example.com').at(-1);
  assert.equal(told.subject, 'Your Venn account moved to another email');
  assert.equal((await post('/api/auth/email/login', { email: 'gil2@example.com', password: 'tangerine-kayak-41' })).status, 200);
  assert.equal((await post('/api/auth/email/login', { email: 'gil@example.com', password: 'tangerine-kayak-41' })).status, 401);
});

test('deleting an account with a password asks for it', async () => {
  const here = await signUp('hal@example.com');
  assert.equal((await call('/api/me', { method: 'DELETE', cookie: here })).status, 403);
  assert.equal((await call('/api/me', { method: 'DELETE', body: { password: 'nope' }, cookie: here })).status, 403);
  assert.equal((await call('/api/me', { method: 'DELETE', body: { password: 'tangerine-kayak-41' }, cookie: here })).status, 200);
  assert.equal((await post('/api/auth/email/login', { email: 'hal@example.com', password: 'tangerine-kayak-41' })).status, 401);
  // The address is free to sign up again.
  await signUp('hal@example.com');
});

// ---------- with Google ----------

async function google(sub, email, { cookie, connect = false } = {}) {
  const start = await call(`/api/auth/google?next=/me/settings${connect ? '&connect=1' : ''}`, { cookie });
  const to = new URL(start.headers.get('location'));
  const flow = cookieOf(start, 'venn_signin');
  googleClaims = {
    iss: 'https://accounts.google.com',
    aud: 'g-client',
    sub,
    email,
    email_verified: true,
    name: 'Ivy Chen',
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce: to.searchParams.get('nonce'),
  };
  const back = await call(`/api/auth/google/callback?code=ok&state=${to.searchParams.get('state')}`, {
    cookie: [flow, cookie].filter(Boolean).join('; '),
  });
  return { location: back.headers.get('location'), session: cookieOf(back) };
}

test('a Google account with the same email is never joined up by itself', async () => {
  const mine = await signUp('ivy@example.com');
  const { session } = await google('g-ivy', 'ivy@example.com');
  const a = (await call('/api/me', { cookie: mine })).data.user;
  const b = (await call('/api/me', { cookie: session })).data.user;
  assert.equal(a.provider, 'email');
  assert.equal(b.provider, 'google'); // two accounts
});

test('connecting Google in settings: then it signs in to the same account', async () => {
  const mine = await signUp('jo@example.com');
  const linked = await google('g-jo', 'jo.personal@gmail.com', { cookie: mine, connect: true });
  assert.equal(linked.location, '/me/settings#connected');
  const settings = (await call('/api/me/settings', { cookie: mine })).data;
  assert.deepEqual(settings.connected, [{ provider: 'google', label: 'Google', email: 'jo.personal@gmail.com', primary: false }]);
  assert.deepEqual(settings.connectable, []);
  const { session } = await google('g-jo', 'jo.personal@gmail.com');
  assert.equal((await call('/api/me', { cookie: session })).data.user.email, 'jo@example.com');
  // A Google account that's already its own Venn account can't be connected to another.
  const other = await signUp('kim@example.com');
  assert.equal((await google('g-jo', 'x@gmail.com', { cookie: other, connect: true })).location, '/me/settings#connect-taken');
  // Signed out, connecting goes nowhere.
  assert.equal((await google('g-new', 'x@gmail.com', { connect: true })).location, '/me/settings#connect-failed');
  // Disconnecting: Google then makes an account of its own again.
  assert.equal((await call('/api/me/identities/google', { method: 'DELETE', cookie: mine })).status, 200);
  const again = await google('g-jo', 'jo.personal@gmail.com');
  assert.equal((await call('/api/me', { cookie: again.session })).data.user.provider, 'google');
});

test('a Google account can add a password through a link sent to its address', async () => {
  const { session } = await google('g-lu', 'lu@example.com');
  const s = (await call('/api/me/settings', { cookie: session })).data;
  assert.equal(s.login, null);
  assert.deepEqual(s.connected, [{ provider: 'google', label: 'Google', email: 'lu@example.com', primary: true }]);
  assert.deepEqual((await post('/api/me/password/link', {}, session)).data, { ok: true, email: 'lu@example.com' });
  const { token, mail } = await lastLink('lu@example.com');
  assert.equal(mail.subject, 'Add a password to your Venn account');
  assert.equal((await post('/api/auth/email/check', { token, kind: 'reset' })).data.hasPassword, false);
  assert.equal((await post('/api/auth/email/reset', { token, password: 'my-first-password-3' })).status, 200);
  const login = await post('/api/auth/email/login', { email: 'lu@example.com', password: 'my-first-password-3' });
  assert.equal((await call('/api/me', { cookie: cookieOf(login) })).data.user.provider, 'google'); // the same account
  // Signing up with that address now says "you already have an account".
  await post('/api/auth/email/signup', { email: 'lu@example.com', password: 'tangerine-kayak-41' });
  assert.equal((await lastLink('lu@example.com')).mail.subject, 'You already have a Venn account');
});

test('signing up with a Google account’s email offers to add a password to it', async () => {
  const { session } = await google('g-mo', 'mo@example.com');
  await post('/api/auth/email/signup', { email: 'mo@example.com', password: 'tangerine-kayak-41' });
  const { token, mail } = await lastLink('mo@example.com');
  assert.match(mail.text, /signs in with Google/);
  assert.equal((await post('/api/auth/email/reset', { token, password: 'tangerine-kayak-41' })).status, 200);
  const login = await post('/api/auth/email/login', { email: 'mo@example.com', password: 'tangerine-kayak-41' });
  assert.equal(login.status, 200);
  assert.equal((await call('/api/me', { cookie: session })).data.user, null); // signed out everywhere
});
