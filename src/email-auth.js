// Signing in with an email and a password, for people without (or not wanting) Google, Microsoft or
// GitHub. It switches on when the server can send email (docs/NOTIFICATIONS.md), because every
// account's address is confirmed by a link before it can sign in, and a forgotten password is
// reset by one. EMAIL_SIGNIN=off keeps it off even then. See docs/ACCOUNTS.md.
//
// What it does, and how (the reasoning is in docs/ACCOUNTS.md):
// - Signing up never says whether an address already has an account: it always answers "check your
//   inbox", and the email says what to do (confirm, or "you already have an account").
// - An account exists only once its address is confirmed, so nobody can claim someone else's email.
// - Emailed links carry their secret after `#`, so it never reaches a server log; the page asks for
//   a tap (a POST) before using it, so mail scanners that open links can't use them up.
// - Links are random 256-bit secrets, stored as SHA-256 hashes, used once, and short-lived.
// - Wrong passwords are counted per account; after 10 in a row, that account pauses for 15 minutes.
// - Setting a new password signs out every browser; changing it signs out all the others.
// - Accounts are never joined up by matching emails. A Google (or other) sign-in joins an account
//   only when connected from Account settings while signed in.

import { bindingAllows } from './limits.js';
import { ValidationError, isEmail } from '../public/core.js';
import { emailEnabled, sendEmail } from './notify.js';
import { withinDailyLimit } from './recipients.js';
import { button, emailLayout, escHtml, heading, linkLine, para } from './notify.js';
import { siteOrigin } from './site.js';
import { acceptablePassword, decoyHash, hashPassword, needsRehash, verifyPassword } from './password.js';

export const SIGNUP_HOURS = 24;
export const RESET_MINUTES = 60;
export const CHANGE_HOURS = 24;
export const LINKS_PER_HOUR = 3; // emails of these links to any one address
export const LOCK_AFTER = 10; // wrong passwords in a row
export const LOCK_MINUTES = 15;
const IP_WINDOW_MS = 10 * 60_000;
const sharedWindows = new Map();

/** Email sign-in is on when the server sends email, unless EMAIL_SIGNIN is "off". */
export const emailSignInEnabled = (env) => emailEnabled(env) && String(env.EMAIL_SIGNIN || '').toLowerCase() !== 'off';

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** An email address as a login: trimmed and lowercased, or a ValidationError. */
export function loginEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) throw new ValidationError('Enter your email');
  if (!isEmail(email)) throw new ValidationError('That doesn’t look like an email address');
  return email;
}

const tokenOf = (body) => {
  if (typeof body?.token !== 'string' || !TOKEN_RE.test(body.token)) throw new ValidationError('That link isn’t complete');
  return body.token;
};

/**
 * At most AUTH_RATE_LIMIT (default 30) email sign-in requests per 10 minutes from one address, and
 * Cloudflare's rate limiting binding AUTH_RATE_LIMITER's limit when there is one. The per-account lock is the real guard; this
 * stops one machine from hammering many accounts.
 */
export async function allowAuthRequest(env, ip, now, windows = sharedWindows) {
  if (!(await bindingAllows(env.AUTH_RATE_LIMITER, ip || 'unknown'))) return false;
  const limit = Number(env.AUTH_RATE_LIMIT) || 30;
  const key = ip || 'unknown';
  const recent = (windows.get(key) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= limit) return false;
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 10_000) windows.clear();
  return true;
}

// ---------- the emails ----------

const footer = (why) => `${escHtml(why)} If this wasn’t you, you can ignore this email.`;

function linkEmail({ subject, title, lines, link, label, after, why, origin }) {
  const text = `${title}\n\n${lines.join('\n\n')}\n\n${label}: ${link}\n\n${after ? `${after}\n\n` : ''}${why} If this wasn’t you, you can ignore this email.\n`;
  const html = emailLayout(
    `${heading(escHtml(title))}${lines.map((l) => para(escHtml(l))).join('')}${button(link, label)}${linkLine(link)}${after ? para(escHtml(after)) : ''}`,
    footer(why),
    origin,
    { signed: false },
  );
  return { subject, text, html };
}

function noticeEmail({ subject, title, lines, origin, why }) {
  const text = `${title}\n\n${lines.join('\n\n')}\n\n${why}\n`;
  const html = emailLayout(`${heading(escHtml(title))}${lines.map((l) => para(escHtml(l))).join('')}`, escHtml(why), origin, {
    signed: false,
  });
  return { subject, text, html };
}

export const signupEmail = (link, origin) =>
  linkEmail({
    subject: 'Confirm your email for Venn',
    title: 'Confirm your email',
    lines: ['Tap the button to finish making your Venn account. Then all your polls are in My polls, on any device.'],
    link,
    label: 'Confirm my email',
    after: `The link works once, for ${SIGNUP_HOURS} hours.`,
    why: 'Someone signed up for Venn with this address.',
    origin,
  });

export const alreadyEmail = (link, origin) =>
  linkEmail({
    subject: 'You already have a Venn account',
    title: 'You already have an account',
    lines: [
      'Someone tried to sign up for Venn with this address, but it already has an account. Sign in with your password, or choose a new one:',
    ],
    link,
    label: 'Choose a new password',
    after: `The link works once, for ${RESET_MINUTES} minutes.`,
    why: 'You get this because of a sign-up with this address.',
    origin,
  });

export const providerAccountEmail = (link, providerLabel, origin) =>
  linkEmail({
    subject: 'You already have a Venn account',
    title: 'You already have an account',
    lines: [
      `This address already has a Venn account, which signs in with ${providerLabel}. Use “Continue with ${providerLabel}”, or add a password to the same account:`,
    ],
    link,
    label: 'Add a password',
    after: `The link works once, for ${RESET_MINUTES} minutes.`,
    why: 'You get this because of a sign-up with this address.',
    origin,
  });

export const resetEmail = (link, origin, { set = false } = {}) =>
  linkEmail({
    subject: set ? 'Add a password to your Venn account' : 'Reset your Venn password',
    title: set ? 'Add a password' : 'Choose a new password',
    lines: [
      set
        ? 'Tap the button to choose a password, so you can also sign in with your email.'
        : 'Tap the button to choose a new password for Venn.',
    ],
    link,
    label: set ? 'Add a password' : 'Choose a new password',
    after: `The link works once, for ${RESET_MINUTES} minutes.`,
    why: set ? 'You asked to add a password to your Venn account.' : 'Someone asked to reset the password for this address.',
    origin,
  });

export const changeEmailEmail = (link, origin) =>
  linkEmail({
    subject: 'Confirm your new email for Venn',
    title: 'Confirm your new email',
    lines: ['Tap the button to sign in to Venn with this address from now on.'],
    link,
    label: 'Use this email',
    after: `The link works once, for ${CHANGE_HOURS} hours.`,
    why: 'You asked to move your Venn account to this address.',
    origin,
  });

export const passwordChangedEmail = (origin, { added = false } = {}) =>
  noticeEmail({
    subject: added ? 'A password was added to your Venn account' : 'Your Venn password was changed',
    title: added ? 'Password added' : 'Password changed',
    lines: [
      added
        ? 'You can now sign in to Venn with this email and your password.'
        : 'The password for your Venn account was just changed, and other devices were signed out.',
      `If this wasn’t you, reset your password now at ${origin}/me#forgot, and write to us by replying to this email.`,
    ],
    why: 'We email you about every change to your password.',
    origin,
  });

export const emailChangedEmail = (newEmail, origin) =>
  noticeEmail({
    subject: 'Your Venn account moved to another email',
    title: 'Your email was changed',
    lines: [
      `Your Venn account now signs in with ${newEmail}, so this address no longer does.`,
      'If this wasn’t you, reply to this email and we’ll help you get your account back.',
    ],
    why: 'We email your old address when the email of your account changes.',
    origin,
  });

// ---------- the flows ----------

/**
 * POST /api/auth/email/:action (signup, confirm, login, forgot, check, reset, change), and the
 * signed-in POST /api/me/password, /api/me/password/link, /api/me/email, /api/me/sessions/others.
 * Returns a Response, or null for paths it doesn't handle.
 *
 * `startSession(userId)` signs this browser in (a Response with the cookie); `user` and
 * `sessionHash` are the signed-in person, for /api/me.
 */
export async function handleEmailAuth(ctx) {
  const { parts, method, env, error } = ctx;
  if (parts[0] === 'auth' && parts[1] === 'email') {
    if (!emailSignInEnabled(env)) return error(404, 'Signing in with email isn’t set up on this server');
    if (method !== 'POST') return error(405, 'Method not allowed');
    if (parts.length !== 3 || !Object.hasOwn(PUBLIC, parts[2])) return error(404, 'Not found');
    if (!(await allowAuthRequest(env, ctx.clientIp, ctx.now, ctx.windows)))
      return error(429, 'That’s a lot of tries. Wait a few minutes, then try again.');
    return PUBLIC[parts[2]](ctx, await ctx.readJson(ctx.request, 10_000));
  }
  if (parts[0] === 'me' && method === 'POST') {
    const action = parts.slice(1).join('/');
    if (!Object.hasOwn(SIGNED_IN, action)) return null;
    if (!ctx.user) return error(401, 'Sign in first');
    if (action !== 'sessions/others' && !emailEnabled(env)) return error(404, 'This server doesn’t send email');
    return SIGNED_IN[action](ctx, await ctx.readJson(ctx.request, 10_000));
  }
  return null;
}

/** Email a link to finish `purpose`, unless the address has had LINKS_PER_HOUR of them already. */
async function sendLink(ctx, { purpose, email, userId = null, data = null, minutes, path, make }) {
  const { store, now, url, env, fetchImpl, waitUntil } = ctx;
  if ((await store.countEmailTokens(email, now - 3_600_000)) >= LINKS_PER_HOUR) return false;
  const token = randomToken();
  await store.createEmailToken({
    hash: await ctx.sha256(token),
    purpose,
    email,
    userId,
    data,
    now,
    expiresAt: now + minutes * 60_000,
  });
  const site = siteOrigin(env, url); // PUBLIC_URL, or this request's own (src/site.js)
  const link = `${site}${path}#t=${token}`;
  if (!(await withinDailyLimit(store, env, {}, now))) return true; // "check your inbox", as ever
  waitUntil(
    sendEmail(env, { to: email, ...make(link, site) }, { fetchImpl }).catch((e) =>
      console.error('sign-in email failed', e.message),
    ),
  );
  return true;
}

const notify = (ctx, to, msg) =>
  to &&
  ctx.waitUntil(
    withinDailyLimit(ctx.store, ctx.env, {}, ctx.now)
      .then((ok) => ok && sendEmail(ctx.env, { to, ...msg }, { fetchImpl: ctx.fetchImpl }))
      .catch((e) => console.error('notice failed', e.message)),
  );

/** "Check your inbox", whatever happened: the same answer whether or not the address has an account. */
const sent = (ctx, email) => ctx.json({ ok: true, email });

/** A reset link to an account's address, saying what the link is for. */
async function resetLink(ctx, account, email, make) {
  return sendLink(ctx, { purpose: 'reset', email, userId: account.id, minutes: RESET_MINUTES, path: '/me/reset', make });
}

const PUBLIC = {
  // { email, password }: always "check your inbox". The email says what to do next.
  async signup(ctx, body) {
    const email = loginEmail(body.email);
    await acceptablePassword(body.password, { email, fetchImpl: ctx.fetchImpl, env: ctx.env });
    const hash = await hashPassword(body.password); // even when it won't be used, so every answer takes as long
    const account = await ctx.store.findUserByVerifiedEmail(email);
    if (account?.hasPassword) await resetLink(ctx, account, email, alreadyEmail);
    else if (account)
      await resetLink(ctx, account, email, (link, origin) =>
        providerAccountEmail(link, ctx.providerLabel(account.provider), origin),
      );
    else
      await sendLink(ctx, {
        purpose: 'signup',
        email,
        data: hash,
        minutes: SIGNUP_HOURS * 60,
        path: '/me/confirm',
        make: signupEmail,
      });
    return sent(ctx, email);
  },

  // { token }: the sign-up link. Makes the account and signs this browser in.
  async confirm(ctx, body) {
    const { store, now } = ctx;
    const t = await store.takeEmailToken(await ctx.sha256(tokenOf(body)), 'signup', now);
    if (!t) return ctx.error(410, 'That link has expired or was already used. Sign up again for a new one.');
    await store.dropEmailTokens({ email: t.email, purpose: 'signup' });
    if (await store.getPassword({ email: t.email }))
      return ctx.error(409, 'This email already has an account. Sign in with your password.');
    const user = await store.createEmailUser({ email: t.email, hash: t.data, now });
    return ctx.startSession(user.id, { ok: true, email: t.email });
  },

  // { email, password }
  async login(ctx, body) {
    const { store, now } = ctx;
    const email = loginEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const wrong = () =>
      ctx.error(401, 'That email and password don’t match. If you signed up with Google, Microsoft or GitHub, use that button.');
    const login = await store.getPassword({ email });
    if (!login) {
      await verifyPassword(password, await decoyHash());
      return wrong();
    }
    if (login.lockedUntil > now) {
      const minutes = Math.ceil((login.lockedUntil - now) / 60_000);
      return ctx.error(
        429,
        `Too many wrong passwords. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or reset your password.`,
      );
    }
    if (!(await verifyPassword(password, login.hash))) {
      await store.passwordFailed(login.userId, login.failed + 1 >= LOCK_AFTER ? now + LOCK_MINUTES * 60_000 : null);
      return wrong();
    }
    await store.passwordWorked(login.userId, needsRehash(login.hash) ? await hashPassword(password) : null);
    return ctx.startSession(login.userId, { ok: true });
  },

  // { email }: a reset link, if the address has an account. The same answer either way.
  async forgot(ctx, body) {
    const email = loginEmail(body.email);
    const account = await ctx.store.findUserByVerifiedEmail(email);
    if (account) await resetLink(ctx, account, email, (link, origin) => resetEmail(link, origin, { set: !account.hasPassword }));
    return sent(ctx, email);
  },

  // { token, kind: 'reset' | 'change' }: is this link still good? For the page it opens.
  async check(ctx, body) {
    const kind = body.kind === 'change' ? 'change' : 'reset';
    const t = await ctx.store.peekEmailToken(await ctx.sha256(tokenOf(body)), kind, ctx.now);
    if (!t) return ctx.error(410, 'That link has expired or was already used.');
    const user = kind === 'reset' && (await ctx.store.getPassword({ email: t.email }));
    return ctx.json({ ok: true, email: t.email, hasPassword: Boolean(user) });
  },

  // { token, password }: a new password (or a first one, for a Google or GitHub account). Every
  // browser is signed out, and the person signs in again with the new password.
  async reset(ctx, body) {
    const { store, now } = ctx;
    const hash = await ctx.sha256(tokenOf(body));
    const live = await store.peekEmailToken(hash, 'reset', now);
    if (!live) return ctx.error(410, 'That link has expired or was already used. Ask for a new one.');
    await acceptablePassword(body.password, { email: live.email, fetchImpl: ctx.fetchImpl, env: ctx.env });
    const t = await store.takeEmailToken(hash, 'reset', now);
    if (!t || !(await store.getUser(t.userId)))
      return ctx.error(410, 'That link has expired or was already used. Ask for a new one.');
    const had = await store.getPassword({ userId: t.userId });
    const holder = await store.getPassword({ email: t.email });
    if (holder && holder.userId !== t.userId) return ctx.error(409, 'This email already signs in to another account.');
    await store.setPassword({ userId: t.userId, email: had?.email || t.email, hash: await hashPassword(body.password), now });
    await store.deleteSessions(t.userId);
    await store.dropEmailTokens({ userId: t.userId, purpose: 'reset' });
    await store.dropEmailTokens({ userId: t.userId, purpose: 'change' });
    notify(ctx, t.email, passwordChangedEmail(siteOrigin(ctx.env, ctx.url), { added: !had }));
    return ctx.json({ ok: true, email: had?.email || t.email });
  },

  // { token }: the link sent to a new address. From then on, the account signs in with it.
  async change(ctx, body) {
    const { store, now } = ctx;
    const t = await store.takeEmailToken(await ctx.sha256(tokenOf(body)), 'change', now);
    if (!t) return ctx.error(410, 'That link has expired or was already used.');
    const login = await store.getPassword({ userId: t.userId });
    if (!login) return ctx.error(410, 'That link has expired or was already used.');
    const holder = await store.getPassword({ email: t.email });
    if (holder && holder.userId !== t.userId) return ctx.error(409, 'This email already signs in to another account.');
    await store.changeEmail(t.userId, t.email);
    await store.dropEmailTokens({ userId: t.userId, purpose: 'change' });
    await store.dropEmailTokens({ userId: t.userId, purpose: 'reset' });
    if (login.email !== t.email) notify(ctx, login.email, emailChangedEmail(t.email, siteOrigin(ctx.env, ctx.url)));
    return ctx.json({ ok: true, email: t.email });
  },
};

/** The signed-in person's password, checked like a sign-in (it counts towards the lock). */
async function checkCurrent(ctx, login, password) {
  if (login.lockedUntil > ctx.now) return ctx.error(429, 'Too many wrong passwords. Try again in a few minutes.');
  if (typeof password === 'string' && (await verifyPassword(password, login.hash))) {
    await ctx.store.passwordWorked(login.userId);
    return null;
  }
  await ctx.store.passwordFailed(login.userId, login.failed + 1 >= LOCK_AFTER ? ctx.now + LOCK_MINUTES * 60_000 : null);
  return ctx.error(403, 'That’s not your current password');
}

const SIGNED_IN = {
  // { current, password }: a new password. Other browsers are signed out; this one stays.
  async password(ctx, body) {
    const { store, user, now } = ctx;
    const login = await store.getPassword({ userId: user.id });
    if (!login) return ctx.error(400, 'This account has no password yet. Add one with the emailed link.');
    const denied = await checkCurrent(ctx, login, body.current);
    if (denied) return denied;
    await acceptablePassword(body.password, { email: login.email, fetchImpl: ctx.fetchImpl, env: ctx.env });
    await store.setPassword({ userId: user.id, email: login.email, hash: await hashPassword(body.password), now });
    await store.deleteSessions(user.id, ctx.sessionHash);
    await store.dropEmailTokens({ userId: user.id, purpose: 'reset' });
    notify(ctx, login.email, passwordChangedEmail(siteOrigin(ctx.env, ctx.url)));
    return ctx.json({ ok: true });
  },

  // {}: for an account that signs in with Google, Microsoft or GitHub: email a link to add a
  // password. The link proves the address is theirs, which Microsoft's sign-in doesn't.
  async 'password/link'(ctx) {
    const { store, user } = ctx;
    if (await store.getPassword({ userId: user.id })) return ctx.error(400, 'This account already has a password');
    const email = user.email && isEmail(user.email.toLowerCase()) ? user.email.toLowerCase() : null;
    if (!email) return ctx.error(400, 'This account has no email address to send a link to');
    const holder = await store.getPassword({ email });
    if (holder) return ctx.error(409, 'This email already signs in to another Venn account');
    const ok = await resetLink(ctx, user, email, (link, origin) => resetEmail(link, origin, { set: true }));
    if (!ok) return ctx.error(429, 'We’ve sent a few links already. Check your inbox, or try again in an hour.');
    return ctx.json({ ok: true, email });
  },

  // { email, password }: move the account's sign-in to a new address, once a link sent there is used.
  async email(ctx, body) {
    const { store, user } = ctx;
    const login = await store.getPassword({ userId: user.id });
    if (!login) return ctx.error(400, 'Only accounts with a password sign in with an email');
    const email = loginEmail(body.email);
    if (email === login.email) return ctx.error(400, 'That’s already your email');
    const denied = await checkCurrent(ctx, login, body.password);
    if (denied) return denied;
    const ok = await sendLink(ctx, {
      purpose: 'change',
      email,
      userId: user.id,
      minutes: CHANGE_HOURS * 60,
      path: '/me/email',
      make: changeEmailEmail,
    });
    if (!ok) return ctx.error(429, 'We’ve sent a few links there already. Check that inbox, or try again in an hour.');
    return ctx.json({ ok: true, email });
  },

  // {}: sign out every other browser and device.
  async 'sessions/others'(ctx) {
    await ctx.store.deleteSessions(ctx.user.id, ctx.sessionHash);
    return ctx.json({ ok: true });
  },
};
