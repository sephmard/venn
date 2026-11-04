// Accounts, and only if you want one. Venn works fully without signing in: polls and brand
// templates keep their secret organizer and manage links. Signing in (with Google, Microsoft or
// GitHub) keeps those polls and templates in one list, "My polls", on any device.
//
// Sign-in is plain OAuth 2.0 / OpenID Connect run by the server (the Worker or server.js), with no
// library: the authorization-code flow with PKCE, a `state` bound to a short-lived cookie, and the
// ID token taken straight from the provider's token endpoint over TLS (so, as OpenID Connect
// allows, its issuer is checked rather than its signature). Each provider switches on when its
// client ID and secret are set; /api/config lists the ones that are.
//
// A signed-in browser holds a random session token in an HttpOnly cookie; the server keeps only its
// SHA-256 hash, as it does for organizer links. Venn keeps your name, email and the provider's id for
// you, nothing else (no picture, no contacts, no calendar).

import { ValidationError } from '../public/core.js';
import { BRAND_ID_RE } from './brands.js';
import { readDefaults, writeDefault } from './defaults.js';
import { emailSignInEnabled, handleEmailAuth } from './email-auth.js';
import { verifyPassword } from './password.js';

export const SESSION_DAYS = 30;
const SESSION_COOKIE = 'venn_session';
const FLOW_COOKIE = 'venn_signin';
const FLOW_MINUTES = 10;
const MAX_CLAIM = 200;
const POLL_ID_RE = /^[A-Za-z0-9]{1,32}$/;

/** The sign-in providers: where to send people, and how to read who they are. */
const PROVIDERS = {
  google: {
    label: 'Google',
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    secret: (env) => env.GOOGLE_CLIENT_SECRET,
    authorize: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    token: () => 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    issuer: (iss) => iss === 'https://accounts.google.com' || iss === 'accounts.google.com',
    extra: { prompt: 'select_account' },
  },
  microsoft: {
    label: 'Microsoft',
    clientId: (env) => env.MICROSOFT_CLIENT_ID,
    secret: (env) => env.MICROSOFT_CLIENT_SECRET,
    authorize: (env) => `https://login.microsoftonline.com/${tenantOf(env)}/oauth2/v2.0/authorize`,
    token: (env) => `https://login.microsoftonline.com/${tenantOf(env)}/oauth2/v2.0/token`,
    scope: 'openid email profile',
    // Each Microsoft organization (and personal accounts) signs as its own tenant.
    issuer: (iss) => /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/.test(iss),
    extra: { prompt: 'select_account' },
  },
  github: {
    label: 'GitHub',
    clientId: (env) => env.GITHUB_CLIENT_ID,
    secret: (env) => env.GITHUB_CLIENT_SECRET,
    authorize: () => 'https://github.com/login/oauth/authorize',
    token: () => 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    api: 'https://api.github.com',
  },
};

const tenantOf = (env) => (/^[\w.-]+$/.test(env.MICROSOFT_TENANT || '') ? env.MICROSOFT_TENANT : 'common');

/**
 * Where a provider's endpoints are. Browser tests point every provider at a stand-in server with
 * OAUTH_TEST_BASE; nothing else should set it.
 */
function endpoint(env, name, which) {
  if (env.OAUTH_TEST_BASE) return `${env.OAUTH_TEST_BASE}/${name}/${which}`;
  const p = PROVIDERS[name];
  return which === 'user' || which === 'emails' ? `${p.api}/user${which === 'emails' ? '/emails' : ''}` : p[which](env);
}

/** The providers people can sign in with on this server, in the order they're shown. */
export const signInProviders = (env) => [
  ...Object.keys(PROVIDERS).filter((n) => PROVIDERS[n].clientId(env) && PROVIDERS[n].secret(env)),
  // An email and a password (src/email-auth.js), when the server sends email to confirm addresses.
  ...(emailSignInEnabled(env) ? ['email'] : []),
];

const oauthProviders = (env) => signInProviders(env).filter((n) => n !== 'email');

export const providerLabel = (name) => (name === 'email' ? 'email' : PROVIDERS[name]?.label || name);

// ---------- small helpers ----------

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pkceChallenge(verifier) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || '').split('.')[1];
  if (!part) throw new Error('No ID token');
  const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

/** The request's cookies, by name. */
export function cookies(request) {
  const out = {};
  for (const pair of (request.headers.get('cookie') || '').split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}

/** A Set-Cookie value: HttpOnly and SameSite=Lax always, Secure on https. */
export function cookie(name, value, { url, maxAge, path = '/api' }) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** Only paths on this site, so a sign-in link can't send anyone elsewhere afterwards. */
// Where signing in may come back to: a path on this site, and on the pages that make a poll or a
// template, only the few query keys that pick one (decisions.md G4), so a template link survives
// signing in. No fragment at all: a template invite's secret waits with the server instead
// (src/api.js join), and never an #admin= or #edit= token, another site, or anything else:
// anything that doesn't fit goes to /me.
const NEXT_PATH = /^\/(?!\/)[\w\-/.]*$/;
const NEXT_QUERY_PATH = /^\/(new|new\/topic|brand\/new|brand\/[A-Za-z0-9]{1,32})$/;
const NEXT_QUERY = {
  brand: /^[A-Za-z0-9]{1,32}$/,
  look: /^(retro|classic)$/,
  ai: /^1$/,
  from: /^[\w-]{1,40}$/,
};
export function safeNext(next) {
  if (typeof next !== 'string' || next.length >= 200 || !next.startsWith('/') || /[\\\s#]/.test(next)) return '/me';
  const [path, query = null] = next.split(/\?(.*)/s);
  if (!NEXT_PATH.test(path)) return '/me';
  if (query !== null) {
    if (!NEXT_QUERY_PATH.test(path) || !query) return '/me';
    const seen = new Set();
    for (const pair of query.split('&')) {
      const [k, v, extra] = pair.split('=');
      if (extra !== undefined || !Object.hasOwn(NEXT_QUERY, k) || seen.has(k) || !NEXT_QUERY[k].test(v ?? '')) return '/me';
      seen.add(k);
    }
  }
  return next;
}

function redirect(location, headers, setCookies = []) {
  const res = new Response(null, { status: 302, headers: { ...headers, location, 'cache-control': 'no-store' } });
  for (const c of setCookies) res.headers.append('set-cookie', c);
  return res;
}

// ---------- who is signed in ----------

/** The SHA-256 hash of this browser's session cookie, or null: how the server knows "this" session. */
export async function sessionHashOf(request) {
  const token = cookies(request)[SESSION_COOKIE];
  return token ? sha256(token) : null;
}

/** Sign this browser in as `userId`: a new session, in a fresh cookie on `res`. */
async function addSession(res, userId, { store, url, now }) {
  const token = randomToken(32);
  await store.createSession({ hash: await sha256(token), userId, now, expiresAt: now + SESSION_DAYS * 86_400_000 });
  res.headers.append('set-cookie', cookie(SESSION_COOKIE, token, { url, maxAge: SESSION_DAYS * 86_400 }));
  return res;
}

/**
 * The signed-in person for this request ({ id, name, email, provider }), or null. A request that
 * changes something and comes from another site is treated as signed out: the cookie is SameSite
 * already, and the API takes only JSON, so this is a third lock on the same door.
 */
export async function sessionUser(request, store, now) {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const safe = request.method === 'GET' || request.method === 'HEAD';
  if (!safe) {
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    if ((origin && origin !== new URL(request.url).origin) || (site && site !== 'same-origin' && site !== 'none')) return null;
  }
  return store.getSessionUser(await sha256(token), now);
}

// ---------- the sign-in flow ----------

async function startSignIn(name, { url, env, headers }) {
  const p = PROVIDERS[name];
  const flow = {
    p: name,
    state: randomToken(16),
    nonce: randomToken(16),
    verifier: randomToken(32),
    next: safeNext(url.searchParams.get('next')),
    // Connecting this sign-in to the account that's signed in (Account settings), not signing in.
    ...(url.searchParams.get('connect') === '1' && { connect: true }),
  };
  const q = new URLSearchParams({
    client_id: p.clientId(env),
    redirect_uri: `${url.origin}/api/auth/${name}/callback`,
    response_type: 'code',
    scope: p.scope,
    state: flow.state,
    code_challenge: await pkceChallenge(flow.verifier),
    code_challenge_method: 'S256',
    ...(name !== 'github' && { nonce: flow.nonce }),
    ...p.extra,
  });
  const value = b64url(new TextEncoder().encode(JSON.stringify(flow)));
  return redirect(`${endpoint(env, name, 'authorize')}?${q}`, headers, [
    cookie(FLOW_COOKIE, value, { url, maxAge: FLOW_MINUTES * 60 }),
  ]);
}

/** Who signed in, from the provider: { subject, email, name }. Throws if anything doesn't check out. */
async function identify(name, code, flow, { url, env, fetchImpl, now }) {
  const p = PROVIDERS[name];
  const res = await fetchImpl(endpoint(env, name, 'token'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${url.origin}/api/auth/${name}/callback`,
      client_id: p.clientId(env),
      client_secret: p.secret(env),
      code_verifier: flow.verifier,
    }),
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || tokens.error) throw new Error(`token exchange failed (${res.status} ${tokens.error || ''})`);

  if (name === 'github') {
    const auth = { authorization: `Bearer ${tokens.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'Venn' };
    const user = await (await fetchImpl(endpoint(env, name, 'user'), { headers: auth })).json();
    if (!user?.id) throw new Error('no GitHub user');
    const emails = await (await fetchImpl(endpoint(env, name, 'emails'), { headers: auth })).json().catch(() => []);
    const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : null;
    return { subject: String(user.id), email: primary?.email || null, name: user.name || user.login || '' };
  }

  const claims = decodeJwtPayload(tokens.id_token);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!p.issuer(claims.iss)) throw new Error('wrong issuer');
  if (!aud.includes(p.clientId(env))) throw new Error('wrong audience');
  if (!(claims.exp * 1000 > now)) throw new Error('expired ID token');
  if (claims.nonce !== flow.nonce) throw new Error('wrong nonce');
  if (!claims.sub) throw new Error('no subject');
  // Only an email the provider vouches for is shown as yours (Microsoft's isn't verified, so it's
  // kept only as a label). Accounts are never matched by email, only by the provider's own id.
  const email = claims.email && (claims.email_verified !== false || name === 'microsoft') ? claims.email : null;
  return { subject: String(claims.sub), email, name: claims.name || claims.given_name || '' };
}

async function finishSignIn(name, { request, url, env, store, fetchImpl, now, headers }) {
  const raw = cookies(request)[FLOW_COOKIE];
  const clear = cookie(FLOW_COOKIE, '', { url, maxAge: 0 });
  let flow = null;
  try {
    flow = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
    );
  } catch {}
  const back = (next, failed) => redirect(failed ? `${next.split('#')[0]}#signin-failed` : next, headers, failed ? [clear] : []);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!flow || flow.p !== name || !state || state !== flow.state || !code) return back(safeNext(flow?.next), true);
  let who;
  try {
    who = await identify(name, code, flow, { url, env, fetchImpl, now });
  } catch (e) {
    console.error('sign-in failed', name, e.message);
    return back(safeNext(flow.next), true);
  }
  // Connecting it to the signed-in account, from Account settings: only if it isn't already
  // someone's (its own account, or connected to another).
  if (flow.connect) {
    const me = await store.getSessionUser((await sessionHashOf(request)) || '', now);
    const next = safeNext(flow.next);
    if (!me) return redirect(`${next.split('#')[0]}#connect-failed`, headers, [clear]);
    const owner = await store.signInOwner(name, who.subject);
    if (owner && owner !== me.id) return redirect(`${next.split('#')[0]}#connect-taken`, headers, [clear]);
    if (!owner) await store.addIdentity({ provider: name, subject: who.subject, userId: me.id, email: who.email, now });
    return redirect(`${next.split('#')[0]}#connected`, headers, [clear]);
  }
  // A sign-in connected to an account signs in to that account; any other is its own account.
  const user =
    (await store.identityUser(name, who.subject)) ||
    (await store.upsertUser({
      provider: name,
      subject: who.subject,
      email: who.email,
      name: who.name.slice(0, 100),
      now,
    }));
  // Back to My polls marked #signed-in, so it shows My polls loading rather than the sign-in page
  // again while it asks the server who this is (that looked like the sign-in hadn't worked).
  const next = safeNext(flow.next);
  return addSession(redirect(next === '/me' ? '/me#signed-in' : next, headers, [clear]), user.id, { store, url, now });
}

// ---------- the account API ----------

const publicUser = (u) => ({
  name: u.name || '',
  email: u.email || null,
  provider: u.provider,
  providerLabel: providerLabel(u.provider),
});

/** Links this browser remembers, sent to be kept with the account: [{ id, token }], checked one by one. */
function claimList(list, idRe) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new ValidationError('Send a list of links');
  if (list.length > MAX_CLAIM) throw new ValidationError(`At most ${MAX_CLAIM} at a time`);
  return list.filter(
    (x) => x && typeof x.id === 'string' && idRe.test(x.id) && typeof x.token === 'string' && x.token.length <= 200,
  );
}

/**
 * /api/auth/* and /api/me*. Returns a Response, or null for paths it doesn't handle.
 * `tokenMatches(token, hash)` is the API's own check of a secret link against its stored hash.
 */
export async function handleAccount({
  request,
  url,
  parts,
  method,
  store,
  env,
  now,
  fetchImpl,
  json,
  error,
  readJson,
  headers,
  tokenMatches,
  waitUntil = (p) => p,
  clientIp = '',
}) {
  // Email and password (src/email-auth.js): signing up, in, and the links it emails.
  const emailCtx = async () => ({
    request,
    url,
    parts,
    method,
    store,
    env,
    now,
    fetchImpl,
    json,
    error,
    readJson,
    waitUntil,
    clientIp,
    sha256,
    providerLabel,
    startSession: (userId, body) => addSession(json(body), userId, { store, url, now }),
  });
  if (parts[0] === 'auth' && parts[1] === 'email') return handleEmailAuth(await emailCtx());
  if (parts[0] === 'auth') {
    const name = parts[1];
    if (name === 'logout' && parts.length === 2) {
      if (method !== 'POST') return error(405, 'Method not allowed');
      const token = cookies(request)[SESSION_COOKIE];
      if (token) await store.deleteSession(await sha256(token));
      const res = json({ ok: true });
      res.headers.append('set-cookie', cookie(SESSION_COOKIE, '', { url, maxAge: 0 }));
      return res;
    }
    if (!Object.hasOwn(PROVIDERS, name) || !oauthProviders(env).includes(name))
      return error(404, "That sign-in isn't set up on this server");
    if (method !== 'GET') return error(405, 'Method not allowed');
    if (parts.length === 2) return startSignIn(name, { url, env, headers });
    if (parts.length === 3 && parts[2] === 'callback')
      return finishSignIn(name, { request, url, env, store, fetchImpl, now, headers });
    return error(404, 'Not found');
  }

  if (parts[0] !== 'me') return null;
  const user = await sessionUser(request, store, now);

  // GET /api/me: who's signed in, with the polls they made, the polls they answered and their brand
  // templates. Signed out, { user: null }.
  if (parts.length === 1 && method === 'GET') {
    if (!user) return json({ user: null, providers: signInProviders(env) });
    const [polls, answered, brands] = await Promise.all([
      store.listOwnedPolls(user.id),
      store.listAnsweredPolls(user.id),
      store.listOwnedBrands(user.id),
    ]);
    // Their default templates (src/defaults.js), so the create page needs no second request.
    const defaults = await readDefaults(store, user.id, brands);
    return json({ user: publicUser(user), polls, answered, brands, defaults });
  }
  if (!user) return error(401, 'Sign in first');

  // GET /api/me/defaults: { defaults: { date, vote } }. PUT { format, template }: set one, or with
  // template null, clear it. Only a template the account owns or has (src/defaults.js).
  if (parts.length === 2 && parts[1] === 'defaults') {
    if (method === 'PUT') {
      const refused = await writeDefault(store, user.id, await readJson(request, 10_000), now);
      if (refused) return error(...refused);
    } else if (method !== 'GET') return error(405, 'Method not allowed');
    return json({ defaults: await readDefaults(store, user.id) });
  }

  // Changing the password or email, and signing out other browsers (src/email-auth.js).
  const sessionHash = await sessionHashOf(request);
  const own = await handleEmailAuth({ ...(await emailCtx()), user, sessionHash });
  if (own) return own;

  // GET /api/me/settings: what Account settings shows: how this account signs in.
  if (parts.length === 2 && parts[1] === 'settings' && method === 'GET') {
    const [login, identities, sessions] = await Promise.all([
      store.getPassword({ userId: user.id }),
      store.listIdentities(user.id),
      store.countSessions(user.id, now),
    ]);
    const connected = [
      ...(user.provider !== 'email' ? [{ provider: user.provider, email: user.email, primary: true }] : []),
      ...identities,
    ];
    return json({
      user: publicUser(user),
      // The address the account signs in with by password, or null when it has no password.
      login: login ? login.email : null,
      emailSignIn: emailSignInEnabled(env),
      connected: connected.map((c) => ({
        provider: c.provider,
        label: providerLabel(c.provider),
        email: c.email || null,
        primary: !!c.primary,
      })),
      // Sign-ins that could be connected: set up here, and not connected yet.
      connectable: oauthProviders(env).filter((p) => !connected.some((c) => c.provider === p)),
      otherSessions: Math.max(0, sessions - 1),
    });
  }

  // DELETE /api/me/identities/:provider: disconnect a sign-in connected in Account settings. The
  // one the account was made with stays, so there's always a way in.
  if (parts.length === 3 && parts[1] === 'identities' && method === 'DELETE') {
    await store.removeIdentity(user.id, parts[2]);
    return json({ ok: true });
  }

  // DELETE /api/me { password }: forget the account. Its polls and templates stay, with their own
  // links. An account with a password asks for it first, so a borrowed phone can't delete it.
  if (parts.length === 1 && method === 'DELETE') {
    const login = await store.getPassword({ userId: user.id });
    if (login) {
      const body = await readJson(request, 10_000).catch(() => ({}));
      if (!(typeof body?.password === 'string' && (await verifyPassword(body.password, login.hash))))
        return error(403, 'That’s not your password');
    }
    await store.deleteUser(user.id);
    const res = json({ ok: true });
    res.headers.append('set-cookie', cookie(SESSION_COOKIE, '', { url, maxAge: 0 }));
    return res;
  }

  // POST /api/me/claim { polls: [{ id, token }], brands: [{ id, token }], answers: [{ id, pid, token }] }:
  // keep these with the account, for anyone holding their organizer, manage or edit link. One that's
  // already someone else's stays theirs.
  if (parts.length === 2 && parts[1] === 'claim' && method === 'POST') {
    const body = await readJson(request, 200_000);
    const added = { polls: 0, brands: 0, answers: 0 };
    for (const { id, pid, token } of claimList(body.answers, POLL_ID_RE)) {
      if (typeof pid !== 'string' || !POLL_ID_RE.test(pid)) continue;
      const p = await store.getParticipant(id, pid);
      if (!p || !(await tokenMatches(token, p.editHash))) continue;
      if (await store.addOwner('answer', pid, user.id, now)) added.answers += 1;
    }
    const kinds = [
      ['poll', claimList(body.polls, POLL_ID_RE), (id) => store.getEvent(id), 'polls'],
      ['brand', claimList(body.brands, BRAND_ID_RE), (id) => store.getBrand(id), 'brands'],
    ];
    for (const [kind, list, get, key] of kinds) {
      for (const { id, token } of list) {
        const item = await get(id);
        if (!item || !(await tokenMatches(token, item.adminHash))) continue;
        if (await store.addOwner(kind, id, user.id, now)) added[key] += 1;
      }
    }
    return json({ added });
  }

  // DELETE /api/me/polls/:id (or brands/:id, answers/:pid): take it off the list. The poll itself
  // stays. A template shared with them: they leave it.
  const KINDS = { polls: 'poll', brands: 'brand', answers: 'answer' };
  if (parts.length === 3 && Object.hasOwn(KINDS, parts[1]) && method === 'DELETE') {
    await store.removeOwner(KINDS[parts[1]], parts[2], user.id);
    if (parts[1] === 'brands') await store.removeBrandMember(parts[2], user.id);
    return json({ ok: true });
  }
  return error(404, 'Not found');
}
