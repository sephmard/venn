// HTTP API built on web-standard Request/Response, shared by the Worker and the Node server.

import {
  LIMITS,
  ValidationError,
  YES,
  allDaySpan,
  isTopicPoll,
  isValidTimeZone,
  buildSlots,
  meetingEnd,
  overlapEnd,
  utcToZoned,
} from '../public/core.js';
import { buildIcs, googleCalendarUrl, outlookCalendarUrl } from '../public/calendar-export.js';
import { setLabel } from './preview.js';
import { applyDeadline, closesLabel, deadlineView, isClosed, normalizeDeadline, remindNow, stopReminders } from './deadline.js';
import { inviteRoom, newInvitees, normalizeInvitees, sendInvites } from './invites.js';
import { checkSingle, normalizeAvailability, normalizeEventInput, normalizeName } from './validate.js';
import { SECURITY_HEADERS } from './security-headers.js';
import { IMAGE_FILES, IMAGE_LIMITS, MAX_IMAGE_BODY, imagePath, imageResponse, parseImage } from './images.js';
import { BRAND_ID_RE, BRAND_ROLES, MAX_BRAND_INVITES, normalizeBrand, publicBrand } from './brands.js';
import {
  MAX_COPIES_PER_ANSWER,
  MAX_COPIES_PER_POLL,
  answerCopyEmail,
  answerLines,
  buildSummary,
  dateSetEmail,
  emailEnabled,
  normalizeEmail,
  notifyResponse,
  pollReadyEmail,
  sendEmail,
  sendWebhook,
  unsubscribeHeaders,
  unsubscribeLink,
  smsPage,
  validateWebhookUrl,
} from './notify.js';
import { pollKind, planOf, recordUsage, sizeOf, usageEnabled, usageReport } from './usage.js';
import {
  AiKeyError,
  AiUnavailableError,
  aiFailure,
  OWN_KEY_HEADER,
  aiAllowance,
  aiClient,
  aiEnabled,
  meteredClient,
  allowAiRequest,
  allowanceKey,
  answerForMe,
  draftDays,
  draftPoll,
  draftTemplate,
  draftTopic,
  summarize,
  validOwnKey,
  weekOf,
  writeMessage,
} from './ai.js';
import { allowContactRequest, contactEmail, contactEnabled, contactInbox, normalizeContact } from './contact.js';
import { allowPlacesRequest, placesProvider, placesState, searchPlaces } from './places.js';
import { handleAccount, sessionUser, signInProviders } from './auth.js';
import { handleMcp } from './mcp.js';
import { draftFromWords } from './days-parse.js';
import { allowWrite, writeWindows as newWriteWindows } from './limits.js';
import { MAX_GUEST_DEVICES, MAX_PUSH_DEVICES, checkSubscription, pushEnabled, sendPush } from './push.js';

const sharedPlaces = placesState();
const sharedContactWindows = new Map();
const sharedWriteWindows = newWriteWindows();

const MAX_BODY = 200_000;
const MAX_DATE_EMAILS = 3;
const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomId(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += ID_ALPHABET[b % ID_ALPHABET.length];
  return s;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function tokenMatches(token, hash) {
  return typeof token === 'string' && token.length > 0 && timingSafeEqual(await sha256(token), hash);
}

/**
 * An app's key (`authorization: Bearer <key>`), one of the server's APP_KEYS: other apps that make
 * brand templates for their own users from their server, where sign-in would otherwise be needed
 * (docs/EMBED.md). Keys are compared as hashes, so the comparison doesn't leak them.
 */
export async function appKeyMatches(header, keys) {
  const key = /^Bearer\s+(\S+)$/i.exec(header || '')?.[1];
  if (!key || !keys) return false;
  const hash = await sha256(key);
  let ok = false;
  for (const k of String(keys).split(',')) if (k.trim() && timingSafeEqual(await sha256(k.trim()), hash)) ok = true;
  return ok;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const error = (status, message) => json({ error: message }, status);

async function readJson(request, max = MAX_BODY) {
  // Only accept real JSON requests. Browsers can't send these cross-site without CORS, which we don't allow.
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json'))
    throw new ValidationError('Requests must be sent as JSON');
  const text = await request.text();
  if (text.length > max) throw new ValidationError('Request is too large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new ValidationError('Invalid JSON');
  }
}

/** The organizer's on/off choices for a poll: privacy, and the retro look (its page and emails).
 * Only the ones switched on are stored. */
const PRIVACY = ['requireEmail', 'hideNames', 'hideResults', 'retro'];

function applyPrivacy(event, body) {
  for (const key of PRIVACY) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean') throw new ValidationError(`${key} must be true or false`);
    if (body[key]) event[key] = true;
    else delete event[key];
  }
  return event;
}

/**
 * The poll as one visitor may see it. The organizer sees everything, including emails. Everyone
 * else sees their own answer in full; other people's names are swapped for "Guest 1, 2…" when the
 * organizer hides names, and other people's answers are left out when the organizer hides them.
 */
function publicEvent(ev, participants, { isAdmin, ownHash = null, ownId = null, emails = new Map() }) {
  // `repeat`: how often a plan repeated, on polls from before that was taken out.
  const { adminHash, hostId, repeat, ...rest } = ev;
  const own = (p) => (ownHash !== null && p.editHash === ownHash) || (ownId !== null && p.id === ownId);
  const visible = isAdmin || !ev.hideResults ? participants : participants.filter(own);
  let guest = 0;
  const list = visible.map(({ editHash, ...p }) => {
    if (isAdmin || own({ editHash, id: p.id })) return emails.has(p.id) ? { ...p, email: emails.get(p.id) } : p;
    guest += 1;
    return ev.hideNames ? { ...p, name: `Guest ${guest}` } : p;
  });
  return {
    ...rest,
    slots: buildSlots(ev),
    isAdmin,
    ...(isAdmin && hostId && { hostId }),
    participants: list,
    ...(visible !== participants && { responses: participants.length }),
    ...(ownId && { yourAnswer: ownId }),
  };
}

/**
 * The organizer's own answer: what they marked for each time (`hostAvailability`, yes or if
 * needed), or yes to every time they offered.
 */
const hostAvailability = (ev, marked) =>
  marked != null
    ? checkSingle(ev, normalizeAvailability(marked, buildSlots(ev)))
    : Object.fromEntries(buildSlots(ev).map((s) => [s, YES]));

/**
 * A guest's email, shown only to the organizer (for the calendar invite once the date is picked):
 * required when the poll asks everyone for one, otherwise theirs to give. null when none.
 */
function participantEmail(ev, body) {
  const email = normalizeEmail(body.email);
  if (!email && ev.requireEmail) throw new ValidationError('Add your email. The organizer asked everyone for one.');
  return email;
}

/** What the organizer sees about their notification settings. Hashes and tokens stay on the server. */
function notifyView(settings, env) {
  const s = settings || {};
  return {
    emailAvailable: emailEnabled(env),
    email: s.email || null,
    // Phones and computers getting a notification; which ones stays on the server.
    pushAvailable: pushEnabled(env),
    pushDevices: (s.push || []).length,
    webhookUrl: s.webhookUrl || null,
    webhookSecret: s.webhookUrl ? s.webhookSecret : null,
    lastDelivery: s.lastDelivery || {},
  };
}

/**
 * A guest's token for stopping Venn's emails about this poll, as "participantId.token". Made the
 * first time Venn emails them, and kept in `settings` (saved by the caller).
 */
function guestToken(settings, participantId) {
  settings.guestTokens = { ...settings.guestTokens };
  settings.guestTokens[participantId] ||= randomId(24);
  return `${participantId}.${settings.guestTokens[participantId]}`;
}

/** The settings with emails stopped for whoever this unsubscribe token belongs to, or null if it's no one's. */
function stopEmails(settings, token) {
  if (typeof token !== 'string' || !token) return null;
  if (settings.unsubscribeToken && timingSafeEqual(token, settings.unsubscribeToken))
    return { ...settings, email: null, accountEmailStopped: true }; // nor to the account's email (src/deadline.js)
  // Someone the organizer invited, stopping their reminders (src/deadline.js).
  const invitee = stopReminders(settings, token, timingSafeEqual);
  if (invitee) return invitee;
  const [participantId, secret = ''] = token.split('.');
  const mine = settings.guestTokens && Object.hasOwn(settings.guestTokens, participantId) && settings.guestTokens[participantId];
  if (!mine || !timingSafeEqual(secret, mine)) return null;
  return { ...settings, stopped: [...new Set([...(settings.stopped || []), participantId])] };
}

/**
 * The deadline and invite list an edited poll gets: what the edit sent, or what it had. Its invite
 * list (and reminders) stay as long as the poll still asks everyone for their email (that's how
 * Venn knows who answered).
 */
function keptDeadline(body, next, ev, settings, at) {
  const r = settings.remind || {};
  const invitees = next.requireEmail ? (r.invitees || []).map((i) => i.email) : [];
  if ('deadline' in body) return normalizeDeadline({ invitees, remindEvery: r.every ?? null, ...body }, next, at);
  const deadline = ev.deadline ?? null;
  return { deadline, remindEvery: deadline != null && invitees.length ? (r.every ?? null) : null, invitees };
}

/** Point the organizer's notifications at an email address, or turn them off with an empty one. */
function setNotifyEmail(settings, value, env) {
  const email = normalizeEmail(value);
  if (email && !emailEnabled(env)) throw new ValidationError("Email notifications aren't set up on this server");
  settings.email = email;
  if (email) settings.unsubscribeToken ||= randomId(24);
  delete settings.origin; // was for "time to plan the next one?" emails, which were taken out
  // From before emails needed no confirmation.
  delete settings.emailConfirmed;
  delete settings.confirmHash;
  delete settings.confirmationsSent;
}

export async function handleApi(request, store, options = {}) {
  const ctx = {};
  const res = await route(request, store, options, ctx);
  // A request that took a free AI request but didn't get an answer (a poll that isn't there, an
  // organizer-only action, a bad time zone, a busy AI) gives it back.
  if (ctx.allowance && !res.ok) await store.returnAiAllowance(ctx.allowance.week, ctx.allowance.who).catch(() => {});
  return res;
}

async function route(
  request,
  store,
  {
    now = Date.now,
    env = {},
    waitUntil = (p) => p,
    fetchImpl = fetch,
    resolveHost,
    clientIp = '',
    anthropic,
    aiWindows,
    places = sharedPlaces,
    contactWindows = sharedContactWindows,
    writeWindows = sharedWriteWindows,
    via,
  } = {},
  ctx = {},
) {
  const options = arguments[2]; // as given, for MCP's own calls back into the API
  const url = new URL(request.url);
  const parts = url.pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean);
  const method = request.method;

  const origin = url.origin;
  const TOO_FAST = "You're going a bit fast. Try again in a few minutes.";
  // Per-visitor limits on new polls, templates and answers (src/limits.js). An app with a key
  // (APP_KEYS) makes them for all its users from one server, so it isn't limited by address.
  const allowed = async (kind) =>
    (await appKeyMatches(request.headers.get('authorization'), env.APP_KEYS)) ||
    allowWrite(env, via === 'mcp' ? 'mcp' : kind, clientIp, now(), writeWindows);
  // Tell the organizer (if they asked) once the response is safely stored. Never blocks the reply.
  const notify = (ev, kind, participantId, name) =>
    waitUntil(notifyResponse({ store, env, fetchImpl, now, origin, ev, kind, participantId, name }));

  /**
   * Email someone a copy of the answer they just saved, if they gave an address. The address is
   * used for this one email and never stored. Copies are counted, so a poll can't be used to
   * flood an inbox.
   */
  /** Count a usage event (src/usage.js), after the response. */
  // Browsers that ask not to be tracked (Global Privacy Control, Do Not Track) aren't counted at all.
  const optedOut = request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1';
  const count = (name, props) => !optedOut && waitUntil(recordUsage(store, env, now(), name, props));
  const kindOf = (ev) => ({ kind: pollKind(ev).kind });

  // Who's signed in (src/auth.js), looked up once and only when it matters.
  let userPromise;
  const currentUser = () => (userPromise ??= sessionUser(request, store, now()));
  /**
   * Whether the signed-in person keeps this poll or template ('poll' | 'brand') with their account,
   * which makes them its organizer as its secret link does. Viewing it, only when they ask to see it
   * as its organizer (`x-organizer: 1`), so on its plain link they see what guests see, as with the link.
   */
  async function ownsIt(kind, id, viewing) {
    if (viewing && request.headers.get('x-organizer') !== '1') return false;
    const user = await currentUser();
    return !!user && (await store.ownerOf(kind, id)) === user.id;
  }
  /** The answer the signed-in person gave on this poll (its participant id), or null. */
  async function answerByAccount(eventId) {
    const user = await currentUser();
    return user ? store.answerIn(user.id, eventId) : null;
  }
  /**
   * Deadlines and reminders come with an account, where the server has sign-in (src/deadline.js);
   * an app with a key (APP_KEYS) sets them for its own users. Without sign-in, anyone can.
   */
  async function mayUseDeadlines() {
    return (
      !signInProviders(env).length ||
      !!(await currentUser()) ||
      (await appKeyMatches(request.headers.get('authorization'), env.APP_KEYS))
    );
  }
  const SIGN_IN_FOR_DEADLINE = 'Sign in to add a deadline and reminders';
  const SIGN_IN_FOR_INVITES = 'Sign in to email your poll to people';

  /**
   * Before saving an invite list (src/invites.js): it needs an account like deadlines, and room
   * under the email limits. Returns an error response, or null when it can go ahead.
   */
  async function checkInvites(eventId, settings, invitees) {
    if (!invitees.length) return null;
    const count = await newInvitees(store, eventId, settings, invitees);
    if (!count) return null;
    if (!(await mayUseDeadlines())) return error(401, SIGN_IN_FOR_INVITES);
    const user = await currentUser();
    const full = await inviteRoom({ store, userId: user?.id, settings, count, now: now() });
    return full ? error(429, full) : null;
  }
  /** Email the poll to whoever on its list hasn't had it yet. */
  async function invite(id) {
    const user = await currentUser();
    return sendInvites({ store, env, fetchImpl, id, userId: user?.id ?? null, now: now(), origin }).catch((e) => {
      console.error('invites failed', e);
      return 0;
    });
  }

  /** Keep what was just made with the signed-in person's account. */
  async function keepWithAccount(kind, id) {
    const user = await currentUser();
    if (user) await store.addOwner(kind, id, user.id, now());
  }

  /** The asker's role on a brand template: 'owner' | 'admin' | 'user', or null. */
  async function brandRoleOf(brand, viewing) {
    if (await tokenMatches(request.headers.get('x-admin-token'), brand.adminHash)) return 'owner';
    if (viewing && request.headers.get('x-organizer') !== '1') return null;
    const user = await currentUser();
    if (!user) return null;
    if ((await store.ownerOf('brand', brand.id)) === user.id) return 'owner';
    return store.brandRole(brand.id, user.id);
  }

  /**
   * Sharing a brand template with other accounts, by invite link: 'admin' links let people change
   * it, 'user' links add it to their templates to make polls with. Only its owner shares it, and
   * anyone it's shared with can leave. Returns null for other paths.
   */
  async function handleSharing(brand, role) {
    const owner = role === 'owner';
    const notOwner = () => error(403, 'Only the template’s owner can share it');
    // GET /api/brands/:id/sharing: who has it, and how many invite links work.
    if (parts.length === 3 && parts[2] === 'sharing' && method === 'GET') {
      if (!owner) return notOwner();
      const [members, invites] = await Promise.all([store.listBrandMembers(brand.id), store.countBrandInvites(brand.id)]);
      return json({ members, invites });
    }
    // POST /api/brands/:id/invites { role }: a new invite link's secret. DELETE (?role=): turn them off.
    if (parts.length === 3 && parts[2] === 'invites') {
      if (!owner) return notOwner();
      if (method === 'POST') {
        const body = await readJson(request, 1000);
        if (!BRAND_ROLES.includes(body?.role)) throw new ValidationError('Choose who the link is for: admin or user');
        const counts = await store.countBrandInvites(brand.id);
        if (counts.admin + counts.user >= MAX_BRAND_INVITES)
          throw new ValidationError('This template has too many invite links. Turn them off and make a new one.');
        const token = randomId(24);
        await store.addBrandInvite({ hash: await sha256(token), brandId: brand.id, role: body.role, now: now() });
        return json({ token, role: body.role }, 201);
      }
      if (method === 'DELETE') {
        const which = url.searchParams.get('role');
        await store.removeBrandInvites(brand.id, BRAND_ROLES.includes(which) ? which : null);
        return json({ ok: true });
      }
      return error(405, 'Method not allowed');
    }
    // POST /api/brands/:id/join { token }: an invite link, opened signed in. The template goes in the
    // account's templates with the link's role (someone who can already change it keeps that).
    if (parts.length === 3 && parts[2] === 'join' && method === 'POST') {
      const user = await currentUser();
      if (!user) return error(401, 'Sign in to add this template');
      const body = await readJson(request, 1000);
      const hash = typeof body?.token === 'string' && /^[A-Za-z0-9]{1,64}$/.test(body.token) ? await sha256(body.token) : null;
      const linkRole = hash && (await store.brandInviteRole(brand.id, hash));
      if (!linkRole) return error(403, 'This invite link was turned off. Ask for a new one.');
      if ((await store.ownerOf('brand', brand.id)) === user.id) return json({ role: 'owner' });
      const had = await store.brandRole(brand.id, user.id);
      const next = had === 'admin' ? 'admin' : linkRole;
      if (next !== had) await store.setBrandMember(brand.id, user.id, next, now());
      count('brand.joined', { role: next });
      return json({ role: next });
    }
    // PUT /api/brands/:id/members/:userId { role }: change what someone can do. DELETE: take it
    // away from them (the owner), or leave it (themselves).
    if (parts.length === 4 && parts[2] === 'members') {
      const memberId = parts[3];
      if (method === 'PUT') {
        if (!owner) return notOwner();
        const body = await readJson(request, 1000);
        if (!BRAND_ROLES.includes(body?.role)) throw new ValidationError('Choose admin or user');
        if (!(await store.brandRole(brand.id, memberId))) return error(404, 'They don’t have this template');
        await store.setBrandMember(brand.id, memberId, body.role, now());
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        const user = await currentUser();
        if (!owner && user?.id !== memberId) return notOwner();
        await store.removeBrandMember(brand.id, memberId);
        return json({ ok: true });
      }
      return error(405, 'Method not allowed');
    }
    return null;
  }

  async function sendCopy(ev, to, { participantId, editToken, name, availability }) {
    if (!to || !emailEnabled(env)) return;
    const settings = (await store.getNotify(ev.id)) || {};
    if (settings.stopped?.includes(participantId)) return;
    const copies = { ...(settings.copies || {}) };
    const total = Object.values(copies).reduce((a, b) => a + b, 0);
    if ((copies[participantId] || 0) >= MAX_COPIES_PER_ANSWER || total >= MAX_COPIES_PER_POLL) return;
    copies[participantId] = (copies[participantId] || 0) + 1;
    const headers = unsubscribeHeaders(unsubscribeLink(origin, ev.id, guestToken(settings, participantId)));
    await store.setNotify(ev.id, { ...settings, copies });
    const pollUrl = `${origin}/e/${ev.id}`;
    const msg = answerCopyEmail({
      title: ev.title,
      name,
      lines: answerLines(ev, availability),
      pollUrl,
      editUrl: `${pollUrl}#edit=${participantId}.${editToken}`,
      seeAnswers: !ev.hideResults,
      retro: ev.retro,
    });
    waitUntil(sendEmail(env, { to, ...msg, headers }, { fetchImpl }).catch((e) => console.error('answer copy failed', e)));
  }

  /** The news on the phones of guests who asked (guest-push.js): the date is picked, or changed. */
  function pushTheDate(ev, changed) {
    waitUntil(
      (async () => {
        const subs = (await store.getNotify(ev.id))?.guestPush || [];
        if (!subs.length || !pushEnabled(env)) return;
        const msg = {
          title: ev.title,
          body: changed ? 'The date changed. Tap to see it.' : 'The date is picked. Tap to see it.',
          url: `${origin}/e/${ev.id}`,
          tag: ev.id,
        };
        const sent = await Promise.all(subs.map((sub) => sendPush(sub, msg, env, { fetchImpl, now: now() }).catch(() => ({}))));
        // Phones that have unsubscribed are forgotten.
        const gone = new Set(subs.filter((_, i) => sent[i].gone).map((sub) => sub.endpoint));
        if (!gone.size) return;
        const latest = (await store.getNotify(ev.id)) || {};
        await store.setNotify(ev.id, { ...latest, guestPush: (latest.guestPush || []).filter((p) => !gone.has(p.endpoint)) });
      })().catch((e) => console.error('date push failed', e)),
    );
  }

  /**
   * Once the organizer picks the date: one "It's happening" email to each guest who gave an address
   * (only polls that ask everyone for one), with calendar links. Once per date, and at most
   * MAX_DATE_EMAILS dates per poll, so changing your mind can't flood anyone's inbox.
   */
  async function emailTheDate(ev, start) {
    if (!emailEnabled(env)) return;
    const settings = (await store.getNotify(ev.id)) || {};
    const sent = settings.datesEmailed || [];
    if (sent.includes(start) || sent.length >= MAX_DATE_EMAILS) return;
    const emails = await store.listEmails(ev.id);
    emails.delete(ev.hostId);
    for (const pid of settings.stopped || []) emails.delete(pid);
    if (!emails.size) return;
    const tokens = new Map([...emails.keys()].map((pid) => [pid, guestToken(settings, pid)]));
    await store.setNotify(ev.id, { ...settings, datesEmailed: [...sent, start] });
    const pollUrl = `${origin}/e/${ev.id}`;
    const end = meetingEnd(ev, start);
    const info = {
      title: ev.title,
      description: [ev.description, `Planned with Venn: ${pollUrl}`].filter(Boolean).join('\n\n'),
      location: ev.location,
      start,
      end,
      allDay: allDaySpan(start, end, ev.timezone),
    };
    const msg = dateSetEmail({
      title: ev.title,
      when: setLabel(ev, start),
      location: ev.location,
      pollUrl,
      calendars: [
        ['Google Calendar', googleCalendarUrl(info)],
        ['Outlook', outlookCalendarUrl(info)],
        ['Apple (iCal)', `${pollUrl.replace('/e/', '/api/events/')}/event.ics`],
      ],
      retro: ev.retro,
    });
    for (const [pid, to] of emails) {
      const headers = unsubscribeHeaders(unsubscribeLink(origin, ev.id, tokens.get(pid)));
      waitUntil(sendEmail(env, { to, ...msg, headers }, { fetchImpl }).catch((e) => console.error('date email failed', e)));
    }
  }

  let ownKey = null; // an AI request's own Anthropic key, if the person brought one
  try {
    // /api/mcp — Venn for AI assistants (src/mcp.js): each tool is a call to this same API.
    if (parts.length === 1 && parts[0] === 'mcp')
      return await handleMcp(request, (path, { method, body }) =>
        handleApi(
          new Request(`${origin}/api/${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body && JSON.stringify(body),
          }),
          store,
          // Claude's servers call for everyone who uses Venn in Claude, so these get their own, higher limit.
          { ...options, via: 'mcp' },
        ),
      );

    // GET /api/health — for uptime monitors: 200 when the database answers, 503 when it doesn't.
    // Says nothing about the server beyond that, and is never cached.
    if (parts.length === 1 && parts[0] === 'health' && method === 'GET') {
      let ok = false;
      try {
        ok = await store.ping();
      } catch (e) {
        console.error('health check: database unreachable', e?.message);
      }
      return json({ ok }, ok ? 200 : 503);
    }

    // GET /api/config — which optional features this server has switched on
    if (parts.length === 1 && parts[0] === 'config' && method === 'GET') {
      return json({
        email: emailEnabled(env),
        ai: aiEnabled(env),
        // AI requests the server's key pays for, per person each week. 0: people bring their own key.
        aiWeekly: aiAllowance(env).perPerson,
        usage: usageEnabled(env),
        // The home page's feature requests and "Contact us", emailed to EMAIL_REPLY_TO.
        contact: contactEnabled(env),
        // Notifications on the organizer's phone: the server's public VAPID key, or false.
        push: pushEnabled(env) ? env.VAPID_PUBLIC_KEY : false,
        // Address search in "Where": 'photon' or 'google' (each needs its own attribution), or false.
        places: placesProvider(env) || false,
        // OAuth client IDs are public by design; they only identify the app to Google/Microsoft.
        // Signing in (src/auth.js), optional: the providers set up on this server, or none.
        accounts: signInProviders(env),
        calendars: {
          google: env.GOOGLE_CLIENT_ID || null,
          microsoft: env.MICROSOFT_CLIENT_ID || null,
          microsoftTenant: env.MICROSOFT_TENANT || 'common',
        },
      });
    }

    // Signing in, and the signed-in person's polls (src/auth.js).
    if (parts[0] === 'auth' || parts[0] === 'me') {
      const res = await handleAccount({
        request,
        url,
        parts,
        method,
        store,
        env,
        now: now(),
        fetchImpl,
        json,
        error,
        readJson,
        headers: SECURITY_HEADERS,
        tokenMatches,
        waitUntil,
        clientIp,
      });
      if (res) return res;
    }

    // POST /api/contact  { kind: 'feature' | 'contact', message, email?, website? }: email it to EMAIL_REPLY_TO
    if (parts.length === 1 && parts[0] === 'contact' && method === 'POST') {
      if (!contactEnabled(env)) return error(404, "Messages aren't turned on for this server");
      const body = await readJson(request, 10_000);
      // `website` is a field people never see. Bots fill it in; pretend it worked.
      if (body.website) return new Response(null, { status: 204, headers: SECURITY_HEADERS });
      const msg = normalizeContact(body);
      if (!(await allowContactRequest(env, clientIp, now(), contactWindows)))
        return error(429, "That's a few messages already. Try again in an hour.");
      try {
        await sendEmail(env, { to: contactInbox(env), ...contactEmail(msg, origin) }, { fetchImpl });
      } catch (e) {
        console.error('contact email failed', e.message);
        return error(502, "Your message didn't send. Try again in a minute.");
      }
      return new Response(null, { status: 204, headers: SECURITY_HEADERS });
    }

    // POST /api/usage  { name, props }: a count from the browser, for usage stats
    if (parts.length === 1 && parts[0] === 'usage' && method === 'POST') {
      const { name, props } = await readJson(request);
      // Over the per-visitor limit, counts are dropped quietly: the browser doesn't need to know.
      if (!optedOut && usageEnabled(env) && (await allowed('usage')))
        await recordUsage(store, env, now(), name, props, { client: true });
      return new Response(null, { status: 204, headers: SECURITY_HEADERS });
    }

    // GET /api/stats?days=30, with "authorization: Bearer <STATS_TOKEN>": the usage stats
    if (parts.length === 1 && parts[0] === 'stats' && method === 'GET') {
      const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
      if (!usageEnabled(env)) return error(404, "Usage stats aren't turned on for this server");
      if (!timingSafeEqual(token, env.STATS_TOKEN)) return error(403, 'Wrong stats token');
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
      return json(await usageReport(store, { days, now: now() }));
    }

    // GET /api/places?q=…&lang=&near=lat,lon&session=: suggested places for "Where" (src/places.js)
    if (parts.length === 1 && parts[0] === 'places' && method === 'GET') {
      if (!placesProvider(env)) return error(404, "Place search isn't turned on for this server");
      if (!(await allowPlacesRequest(env, clientIp, now(), places.windows)))
        return error(429, "You're going a bit fast. Try again in a minute.");
      let found;
      try {
        found = await searchPlaces(env, url.searchParams, { fetchImpl, now: now(), origin, state: places });
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        // Only what went wrong, never what was typed.
        console.error('place search failed', e.name === 'TimeoutError' ? 'timed out' : e.message);
        return error(502, "Place search isn't working right now");
      }
      return new Response(JSON.stringify({ places: found.places }), {
        headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': found.cacheControl },
      });
    }

    // Every AI endpoint: switched on, and rate limited per visitor (each call costs money).
    const isAi = (parts[0] === 'ai' && parts.length === 2) || (parts[0] === 'events' && parts[2] === 'ai' && parts.length === 4);
    // The days on /new can also be read from plain words, with no AI (src/days-parse.js), where AI
    // can't answer: the server has none, or there's no key and no allowance left. Never ahead of AI.
    const daysDraft = parts[0] === 'ai' && parts[1] === 'draft-days' && parts.length === 2;
    async function byWords(otherwise) {
      const { prompt, timezone } = await readJson(request);
      if (!isValidTimeZone(timezone)) throw new ValidationError('Unknown time zone');
      const { date: today, minutes: nowMinutes } = utcToZoned(now(), timezone);
      const draft = typeof prompt === 'string' && draftFromWords(prompt, { today, nowMinutes });
      return draft ? json(draft) : otherwise();
    }
    // Paid for by the key the person brought (kept in their browser, never stored), or by the
    // server's key within this week's allowance.
    if (isAi) {
      if (method !== 'POST') return error(405, 'Method not allowed');
      if (!aiEnabled(env) && !daysDraft) return error(404, "AI features aren't turned on for this server");
      if (!(await allowAiRequest(env, clientIp, now(), aiWindows)))
        return error(429, "You're going a bit fast. Try again in a minute.");
      if (!aiEnabled(env))
        return await byWords(() =>
          error(400, 'Venn couldn’t tell which days from that. Name them, like “Fridays next month”, or pick them below.'),
        );
      const brought = request.headers.get(OWN_KEY_HEADER);
      if (brought && !validOwnKey(brought))
        return error(400, "That doesn't look like an Anthropic API key. They start with sk-ant-.");
      ownKey = brought || null;
      if (!ownKey) {
        const { perPerson, total, budget } = aiAllowance(env);
        const week = weekOf(now());
        const who = perPerson && total ? await allowanceKey(week, (await currentUser())?.id, clientIp) : null;
        // The weekly dollar cap (AI_WEEKLY_BUDGET_USD): once this week's spend reaches it, people bring their own key.
        const overBudget = who && (await store.aiSpend(week)) >= budget;
        const used = !who ? 'off' : overBudget ? 'total' : await store.takeAiAllowance(week, who, perPerson, total);
        if (!used) {
          ctx.allowance = { week, who }; // given back by handleApi if no answer comes of it
          anthropic = meteredClient(anthropic ?? aiClient(env), env, (micros) => store.addAiSpend(week, micros));
        }
        if (used) {
          const noAi = () =>
            error(
              402,
              used === 'off'
                ? 'Add your own Anthropic API key to use AI here.'
                : used === 'person'
                  ? "You've used this week's free AI requests. Add your own Anthropic API key to keep going."
                  : 'Free AI requests are used up for this week. Add your own Anthropic API key to keep going.',
            );
          return daysDraft ? await byWords(noAi) : noAi();
        }
      }
      anthropic ??= aiClient(env, ownKey);
    }

    // POST /api/ai/draft-poll  { prompt, timezone }
    if (isAi && parts[0] === 'ai' && parts[1] === 'draft-poll') {
      const { prompt, timezone } = await readJson(request);
      if (!isValidTimeZone(timezone)) throw new ValidationError('Unknown time zone');
      count('ai.used', { feature: 'draft' });
      return json(await draftPoll(env, { prompt, timezone }, { now: now(), anthropic }));
    }

    // POST /api/ai/draft-days  { prompt, timezone } — the days on "Create a Venn"
    if (isAi && parts[0] === 'ai' && parts[1] === 'draft-days') {
      const { prompt, timezone } = await readJson(request);
      if (!isValidTimeZone(timezone)) throw new ValidationError('Unknown time zone');
      count('ai.used', { feature: 'days' });
      return json(await draftDays(env, { prompt, timezone }, { now: now(), anthropic }));
    }

    // POST /api/ai/draft-topic  { prompt } — a vote's question and options (/new/topic)
    if (isAi && parts[0] === 'ai' && parts[1] === 'draft-topic') {
      const { prompt } = await readJson(request);
      count('ai.used', { feature: 'topic' });
      return json(await draftTopic(env, { prompt }, { anthropic }));
    }

    // POST /api/ai/draft-template  { prompt, name } — a brand template's starting look
    if (isAi && parts[0] === 'ai' && parts[1] === 'draft-template') {
      const { prompt, name } = await readJson(request);
      count('ai.used', { feature: 'template' });
      return json(await draftTemplate(env, { prompt, name }, { anthropic }));
    }

    // POST /api/events
    if (parts.length === 1 && parts[0] === 'events' && method === 'POST') {
      if (!(await allowed('create'))) return error(429, TOO_FAST);
      const body = await readJson(request);
      const event = applyPrivacy(normalizeEventInput(body), body);
      // The next one of a plan: the poll it follows on from must still be there.
      const previous = event.seriesOf && (await store.getEvent(event.seriesOf));
      if (!previous) delete event.seriesOf;
      // Made from a brand template: the poll shows the organization's look, while the template lasts.
      if (body.brand != null) {
        if (typeof body.brand !== 'string' || !BRAND_ID_RE.test(body.brand) || !(await store.getBrand(body.brand)))
          throw new ValidationError('This brand template does not exist or was deleted');
        event.brand = body.brand;
        delete event.retro; // the organization's look replaces the retro one
        delete event.tile; // and its tile
      }
      const notifyEmail = body.notifyEmail ? normalizeEmail(body.notifyEmail) : null;
      if (notifyEmail && !emailEnabled(env)) throw new ValidationError("Email notifications aren't set up on this server");
      // A deadline for answers, and who to email the poll to (src/deadline.js, src/invites.js):
      // checked before anything is saved.
      if (body.deadline != null && !(await mayUseDeadlines())) return error(401, SIGN_IN_FOR_DEADLINE);
      const asked = normalizeDeadline(body, event, now());
      const blocked = await checkInvites(null, {}, asked.invitees);
      if (blocked) return blocked;
      const remind = {};
      const due = applyDeadline(event, remind, asked, { now: now(), origin });
      const id = randomId(10);
      const adminToken = randomId(24);
      // `hostAnswers`: the times the organizer offers count as their own answer (yes to all).
      // A topic poll's organizer votes like everyone else: only an answer they marked counts as theirs.
      const host = body.hostAnswers === true &&
        (!isTopicPoll(event) || body.hostAvailability != null) && { id: randomId(10), editToken: randomId(24) };
      if (host) event.hostId = host.id;
      // Checked before anything is saved, so a bad answer doesn't leave a poll behind.
      const hostAnswer = host && hostAvailability(event, body.hostAvailability);
      await store.createEvent({ id, event, adminHash: await sha256(adminToken), now: now() });
      await keepWithAccount('poll', id);
      if (host)
        await store.insertParticipant({
          id: host.id,
          eventId: id,
          name: event.organizer || 'Organizer',
          availability: hostAnswer,
          editHash: await sha256(host.editToken),
          now: now(),
        });
      if (notifyEmail) {
        // No confirmation step: the organizer gets their poll's link straight away, then an email per answer.
        const settings = { emailsSent: 1, ...remind };
        setNotifyEmail(settings, notifyEmail, env);
        await store.setNotify(id, settings);
        const msg = pollReadyEmail({
          title: event.title,
          pollUrl: `${origin}/e/${id}`,
          unsubscribeUrl: `${origin}/e/${id}#unsubscribe=${settings.unsubscribeToken}`,
          retro: event.retro,
        });
        const headers = unsubscribeHeaders(unsubscribeLink(origin, id, settings.unsubscribeToken));
        waitUntil(
          sendEmail(env, { to: notifyEmail, ...msg, headers }, { fetchImpl }).catch((e) => console.error('poll email failed', e)),
        );
      }
      if (!notifyEmail && remind.remind) await store.setNotify(id, remind);
      if (due != null) await store.setReminderDue(id, due);
      // The poll, emailed to everyone the organizer listed, after the reply.
      if (asked.invitees.length) waitUntil(invite(id));
      count('poll.created', {
        ...pollKind(event),
        plan: planOf(event),
        options: sizeOf(event),
        email: notifyEmail ? 'yes' : 'no',
        copy: body.copied === true ? 'yes' : 'no',
        ...(typeof body.from === 'string' && { from: body.from }),
        ...(event.brand && { brand: 'yes' }),
      });
      return json({ id, adminToken, ...(host && { participant: host }) }, 201);
    }

    // POST /api/brands  { name, accent?, font?, title?, note?, where?, emoji? }: a brand template
    if (parts.length === 1 && parts[0] === 'brands' && method === 'POST') {
      if (!(await allowed('create'))) return error(429, TOO_FAST);
      // Saving a template needs an account, where the server has sign-in (src/auth.js); without it,
      // templates are kept by their manage link alone. Templates made before keep working either way.
      // An app with a key (APP_KEYS) makes them for its own users from its server instead.
      if (
        signInProviders(env).length &&
        !(await currentUser()) &&
        !(await appKeyMatches(request.headers.get('authorization'), env.APP_KEYS))
      )
        return error(401, 'Sign in to save your template');
      const brand = normalizeBrand(await readJson(request, 10_000));
      const id = randomId(10);
      const adminToken = randomId(24);
      await store.createBrand({ id, brand, adminHash: await sha256(adminToken), now: now() });
      await keepWithAccount('brand', id);
      count('brand.created', {});
      return json({ id, adminToken }, 201);
    }

    if (parts[0] === 'brands' && parts[1]) {
      if (!BRAND_ID_RE.test(parts[1])) return error(404, 'This brand template does not exist or was deleted');
      // GET /api/brands/:id/logo?v=: the logo, for anyone with a link to the template or its polls.
      if (parts.length === 3 && parts[2] === 'logo' && (method === 'GET' || method === 'HEAD')) {
        const logo = await store.getBrandLogo(parts[1]);
        if (!logo) return error(404, 'This brand template has no logo');
        return imageResponse(logo, { versioned: url.searchParams.get('v') === String(logo.v), head: method === 'HEAD' });
      }
      const brand = await store.getBrand(parts[1]);
      if (!brand) return error(404, 'This brand template does not exist or was deleted');
      // Who's asking (src/brands.js ROLES): its 'owner' (the manage link, or the account that keeps
      // it), an 'admin' or 'user' it was shared with, or nobody in particular (null). Viewing, as
      // with polls, only when they ask to see it as theirs (`x-organizer: 1`).
      const role = await brandRoleOf(brand, method === 'GET' && parts.length === 2);
      const brandAdmin = role === 'owner' || role === 'admin';
      // GET|PUT|DELETE /api/brands/:id
      if (parts.length === 2) {
        if (method === 'GET') return json({ ...publicBrand(brand), isAdmin: brandAdmin, ...(role && { role }) });
        if (!brandAdmin) return error(403, 'Only whoever has the manage link can change this template');
        if (method === 'PUT') {
          const next = normalizeBrand(await readJson(request, 10_000));
          await store.updateBrand(brand.id, next);
          return json({ ...publicBrand({ ...next, id: brand.id, logoV: brand.logoV }), isAdmin: true, role });
        }
        if (method === 'DELETE') {
          if (role !== 'owner') return error(403, 'Only the template’s owner can delete it');
          await store.deleteBrand(brand.id);
          return json({ ok: true });
        }
        return error(405, 'Method not allowed');
      }
      const shared = await handleSharing(brand, role);
      if (shared) return shared;
      // PUT /api/brands/:id/logo  { logo }: in base64 (src/images.js). DELETE: no logo.
      if (parts.length === 3 && parts[2] === 'logo') {
        if (method !== 'PUT' && method !== 'DELETE') return error(405, 'Method not allowed');
        if (!brandAdmin) return error(403, 'Only whoever has the manage link can change this template');
        const logo =
          method === 'PUT'
            ? parseImage((await readJson(request, Math.ceil((IMAGE_LIMITS.logo * 4) / 3) + 1000)).logo, 'logo')
            : null;
        const v = await store.setBrandLogo(brand.id, logo, now());
        return json({ logo: publicBrand({ ...brand, logoV: v }).logo });
      }
      return error(404, 'Not found');
    }

    if (parts[0] !== 'events' || !parts[1]) return error(404, 'Not found');

    // GET /api/events/:id/icon.jpg and card.jpg: the poll's own picture, for anyone with the link.
    if (parts.length === 3 && IMAGE_FILES[parts[2]] && (method === 'GET' || method === 'HEAD')) {
      const img = await store.getImage(parts[1], IMAGE_FILES[parts[2]]);
      if (!img) return error(404, 'This poll has no picture');
      return imageResponse(img, { versioned: url.searchParams.get('v') === String(img.v), head: method === 'HEAD' });
    }

    const ev = await store.getEvent(parts[1]);
    if (!ev) return error(404, 'This poll does not exist or was deleted');
    const isAdmin =
      (await tokenMatches(request.headers.get('x-admin-token'), ev.adminHash)) ||
      (await ownsIt('poll', ev.id, parts.length === 2 && method === 'GET'));

    // GET|DELETE /api/events/:id
    if (parts.length === 2) {
      if (method === 'GET') {
        // Sending your edit token gets your own answer back, even when the organizer hides answers.
        const editToken = request.headers.get('x-edit-token');
        const ownHash = editToken ? await sha256(editToken) : null;
        // Signed in, an answer given with the account is theirs on any device, as its edit link is.
        const ownId = await answerByAccount(ev.id);
        const emails = isAdmin || ownHash || ownId ? await store.listEmails(ev.id) : undefined;
        const out = publicEvent(ev, await store.listParticipants(ev.id), { isAdmin, ownHash, ownId, emails });
        // Its brand template's look, while the template lasts (deleted, the poll is plain Venn again).
        const brand = ev.brand && (await store.getBrand(ev.brand));
        if (brand) out.brand = publicBrand(brand);
        else delete out.brand;
        return json(out);
      }
      // PUT: the organizer changes the poll, only while nobody else has answered.
      if (method === 'PUT') {
        if (!isAdmin) return error(403, 'Only the organizer can change this poll');
        const participants = await store.listParticipants(ev.id);
        if (participants.some((p) => p.id !== ev.hostId))
          return error(409, "People have already answered, so this poll can't be changed. Duplicate it instead.");
        const body = await readJson(request);
        const next = applyPrivacy(normalizeEventInput(body), body);
        if (ev.hostId) next.hostId = ev.hostId;
        // The edit form doesn't send them, so a poll keeps the one it follows on from, and its brand.
        if (ev.seriesOf) next.seriesOf = ev.seriesOf;
        if (ev.brand) {
          next.brand = ev.brand;
          delete next.tile; // the organization's look has its own tile
        }
        // Its deadline: as sent, or as it was when not sent; a new one needs an account.
        if (body.deadline != null && body.deadline !== ev.deadline && !(await mayUseDeadlines()))
          return error(401, SIGN_IN_FOR_DEADLINE);
        const settings = (await store.getNotify(ev.id)) || {};
        const kept = keptDeadline(body, next, ev, settings, now());
        const blocked = await checkInvites(ev.id, settings, kept.invitees);
        if (blocked) return blocked;
        const due = applyDeadline(next, settings, kept, { now: now(), origin });
        // The organizer's own answer follows the new times: what they sent, or what they'd already
        // answered for the times that are still there. It's checked before the poll changes.
        const host = participants.find((p) => p.id === ev.hostId);
        const hostAnswer =
          host &&
          (body.hostAvailability != null
            ? hostAvailability(next, body.hostAvailability)
            : normalizeAvailability(
                Object.fromEntries(Object.entries(host.availability).filter(([s]) => buildSlots(next).includes(+s))),
                buildSlots(next),
              ));
        // The picked date stays when it's still one of the poll's times (a new title, a note…).
        const keep = ev.finalStart != null && buildSlots(next).includes(ev.finalStart);
        // A topic poll's picked option, the same way (same id, same words).
        const pickedLabel = isTopicPoll(ev) && ev.options.find((o) => o.id === ev.picked)?.label;
        if (pickedLabel && isTopicPoll(next) && next.options.some((o) => o.id === ev.picked && o.label === pickedLabel))
          next.picked = ev.picked;
        if (host)
          await store.updateParticipant({
            id: host.id,
            eventId: ev.id,
            name: next.organizer || host.name,
            availability: hostAnswer,
            now: now(),
          });
        if (keep && next.anyLength) {
          const people = host ? [{ ...host, availability: hostAnswer }] : [];
          next.finalEnd = overlapEnd(next, buildSlots(next), people, ev.finalStart);
        }
        await store.updateEvent(ev.id, next);
        await store.setNotify(ev.id, settings);
        await store.setReminderDue(ev.id, due);
        if (kept.invitees.length) waitUntil(invite(ev.id));
        if (!keep) await store.setFinal(ev.id, null);
        count('poll.edited', kindOf(next));
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        if (!isAdmin) return error(403, 'Only the organizer can delete this poll');
        await store.deleteEvent(ev.id);
        count('poll.deleted', kindOf(ev));
        return json({ ok: true });
      }
      return error(405, 'Method not allowed');
    }

    // GET /api/events/:id/sms: from an email's "Text message" button, on to the phone's messages.
    if (parts.length === 3 && parts[2] === 'sms' && method === 'GET') {
      const page = smsPage({
        title: ev.title,
        pollUrl: `${origin}/e/${ev.id}`,
        userAgent: request.headers.get('user-agent') || '',
      });
      return new Response(page, {
        headers: { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    // GET /api/events/:id/event.ics
    if (parts.length === 3 && parts[2] === 'event.ics' && method === 'GET') {
      if (ev.finalStart == null || isTopicPoll(ev)) return error(404, 'No time has been picked yet');
      const end = meetingEnd(ev, ev.finalStart);
      const body = buildIcs({
        id: ev.id,
        title: ev.title,
        description: [ev.description, `Planned with Venn: ${url.origin}/new`].filter(Boolean).join('\n\n'),
        location: ev.location,
        start: ev.finalStart,
        end,
        allDay: allDaySpan(ev.finalStart, end, ev.timezone),
        url: `${url.origin}/e/${ev.id}`,
        ...(ev.image && { image: { url: url.origin + imagePath(ev.id, ev.image), type: ev.image.type } }),
      });
      count('calendar.ics', {});
      return new Response(body, {
        headers: {
          ...SECURITY_HEADERS,
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': `attachment; filename="${ev.id}.ics"`,
        },
      });
    }

    // /api/events/:id/notifications…
    if (parts[2] === 'notifications') {
      const settings = (await store.getNotify(ev.id)) || {};
      const action = parts[3];

      // Links from emails land on the poll page, which posts the token here. Using the page
      // (not a GET link) means email scanners that pre-open links can't unsubscribe. Mail apps'
      // own unsubscribe buttons use the List-Unsubscribe link (src/notify.js): opened, it leads to
      // the page; posted to ("one-click"), it stops the emails straight away.
      if (action === 'unsubscribe' && parts.length === 4) {
        const linked = url.searchParams.get('token');
        if (method === 'GET' && linked)
          return Response.redirect(`${origin}/e/${ev.id}#unsubscribe=${encodeURIComponent(linked)}`, 303);
        if (method === 'POST') {
          const token = linked ?? (await readJson(request)).token;
          const next = stopEmails(settings, token);
          if (!next) throw new ValidationError('This unsubscribe link is invalid');
          await store.setNotify(ev.id, next);
          return json({ ok: true });
        }
      }

      if (!isAdmin) return error(403, 'Only the organizer can change notifications');

      if (parts.length === 3 && method === 'GET') return json(notifyView(settings, env));

      if (parts.length === 3 && method === 'PUT') {
        const body = await readJson(request);
        if ('email' in body) setNotifyEmail(settings, body.email, env);
        if ('webhookUrl' in body) {
          const webhookUrl = await validateWebhookUrl(body.webhookUrl, { resolveHost });
          if (webhookUrl && (webhookUrl !== settings.webhookUrl || !settings.webhookSecret))
            settings.webhookSecret = `whsec_${randomId(32)}`;
          settings.webhookUrl = webhookUrl;
          if (!webhookUrl) settings.webhookSecret = null;
        }
        // { push: subscription } adds this device (replacing the oldest past the limit); { pushRemove: endpoint } drops it.
        let added = null;
        if (body.push) {
          if (!pushEnabled(env)) throw new ValidationError("Notifications on your phone aren't set up on this server");
          try {
            added = checkSubscription(body.push);
          } catch (e) {
            throw new ValidationError(e.message);
          }
          settings.push = [...(settings.push || []).filter((p) => p.endpoint !== added.endpoint), added].slice(-MAX_PUSH_DEVICES);
        }
        if (typeof body.pushRemove === 'string')
          settings.push = (settings.push || []).filter((p) => p.endpoint !== body.pushRemove);
        await store.setNotify(ev.id, settings);
        if (body.email) count('notify.email', {});
        if (body.webhookUrl) count('notify.webhook', {});
        if (added) {
          count('notify.push', {});
          // A first one straight away, so it's plain it works.
          const hello = {
            title: ev.title,
            body: "You'll get a notification here when someone answers.",
            url: `${origin}/e/${ev.id}`,
            tag: ev.id,
          };
          waitUntil(sendPush(added, hello, env, { fetchImpl, now: now() }).catch((e) => console.error('push failed', e)));
        }
        return json(notifyView(settings, env));
      }

      if (action === 'test' && parts.length === 4 && method === 'POST') {
        if (!settings.webhookUrl) throw new ValidationError('Add a webhook URL first');
        const s = buildSummary(ev, await store.listParticipants(ev.id), { kind: 'test', name: null, origin, now: now() });
        let result;
        try {
          result = await sendWebhook(settings.webhookUrl, settings.webhookSecret, s, { fetchImpl, now: now() });
        } catch (e) {
          result = { ok: false, error: e.name === 'TimeoutError' ? 'Timed out' : 'Could not connect' };
        }
        const latest = (await store.getNotify(ev.id)) || settings;
        await store.setNotify(ev.id, { ...latest, lastDelivery: { ...latest.lastDelivery, webhook: { at: now(), ...result } } });
        return json(result);
      }
      return error(404, 'Not found');
    }

    // POST /api/events/:id/ai/{summary,answer,message}
    if (isAi) {
      const kind = parts[3];
      if (isTopicPoll(ev)) return error(404, 'Not available for this kind of poll');
      if (['answer', 'summary', 'message'].includes(kind)) count('ai.used', { feature: kind });
      if (kind === 'answer') {
        const body = await readJson(request);
        if (body.timezone && !isValidTimeZone(body.timezone)) throw new ValidationError('Unknown time zone');
        return json(await answerForMe(env, ev, body, { anthropic }));
      }
      if (!isAdmin) return error(403, 'Only the organizer can use this');
      const participants = await store.listParticipants(ev.id);
      if (kind === 'summary') return json(await summarize(env, ev, participants, { anthropic }));
      if (kind === 'message') {
        const { kind: messageKind } = await readJson(request);
        return json(await writeMessage(env, ev, participants, { kind: messageKind, url: `${origin}/e/${ev.id}` }, { anthropic }));
      }
      return error(404, 'Not found');
    }

    // PUT /api/events/:id/settings  { requireEmail?, hideNames?, hideResults?, retro? }
    if (parts.length === 3 && parts[2] === 'settings' && method === 'PUT') {
      if (!isAdmin) return error(403, 'Only the organizer can change these settings');
      const { id: _id, adminHash, finalStart, createdAt, ...data } = ev;
      const body = await readJson(request);
      const next = applyPrivacy(data, body);
      delete next.repeat; // plans that repeated were taken out; a poll that had one drops it here
      // No emails, no invite list or reminders: Venn couldn't tell who's answered. The deadline itself stays.
      const s = (await store.getNotify(ev.id)) || {};
      if (!next.requireEmail && (next.deadline != null || s.remind)) {
        const due = applyDeadline(
          next,
          s,
          { deadline: next.deadline ?? null, remindEvery: null, invitees: [] },
          { now: now(), origin },
        );
        await store.setNotify(ev.id, s);
        await store.setReminderDue(ev.id, due);
      }
      await store.updateEvent(ev.id, next);
      return json(Object.fromEntries(PRIVACY.map((k) => [k, !!next[k]])));
    }

    // GET|PUT /api/events/:id/deadline  { deadline, remindEvery, invitees }: when answers close, and
    // who to remind until then (src/deadline.js). Organizer only: it's the one place invitees' emails are.
    if (parts.length === 3 && parts[2] === 'deadline') {
      if (method !== 'GET' && method !== 'PUT') return error(405, 'Method not allowed');
      if (!isAdmin) return error(403, 'Only the organizer can see or change the deadline');
      const settings = (await store.getNotify(ev.id)) || {};
      const { id: _id, adminHash, finalStart, createdAt, ...data } = ev;
      if (method === 'PUT') {
        const body = await readJson(request);
        // Without `invitees`, the poll keeps the list it has (Invite by email changes it).
        const list = (settings.remind?.invitees || []).map((i) => i.email);
        const asked = normalizeDeadline({ invitees: list, ...body }, data, now());
        // Taking a deadline off never needs an account; setting or changing one does.
        if (asked.deadline != null && !(await mayUseDeadlines())) return error(401, SIGN_IN_FOR_DEADLINE);
        const blocked = await checkInvites(ev.id, settings, asked.invitees);
        if (blocked) return blocked;
        const due = applyDeadline(data, settings, asked, {
          now: now(),
          origin,
        });
        await store.updateEvent(ev.id, data);
        await store.setNotify(ev.id, settings);
        await store.setReminderDue(ev.id, due);
        if (asked.invitees.length) await invite(ev.id);
      }
      const fresh = method === 'PUT' ? (await store.getNotify(ev.id)) || {} : settings;
      return json(deadlineView(data, fresh, await store.listEmails(ev.id)));
    }

    // GET|PUT /api/events/:id/invitees  { invitees }: who the poll is emailed to (src/invites.js).
    // Everyone new on the list gets it straight away; the deadline's reminders go to the same list.
    if (parts.length === 3 && parts[2] === 'invitees') {
      if (method !== 'GET' && method !== 'PUT') return error(405, 'Method not allowed');
      if (!isAdmin) return error(403, 'Only the organizer can see or change who is invited');
      const settings = (await store.getNotify(ev.id)) || {};
      const { id: _id, adminHash, finalStart, createdAt, ...data } = ev;
      if (method === 'PUT') {
        if (!emailEnabled(env)) return error(400, "Emails aren't turned on for this server");
        if (isClosed(ev, now()) || ev.finalStart != null || ev.picked != null)
          return error(400, 'This poll is no longer taking answers');
        const invitees = normalizeInvitees((await readJson(request)).invitees);
        const blocked = await checkInvites(ev.id, settings, invitees);
        if (blocked) return blocked;
        const r = settings.remind || {};
        const deadline = data.deadline ?? null;
        // Someone added to a poll with a deadline is reminded as the list was, or the day before.
        const remindEvery = deadline != null && invitees.length ? (r.every ?? 0) : null;
        const due = applyDeadline(data, settings, { deadline, remindEvery, invitees }, { now: now(), origin });
        await store.updateEvent(ev.id, data);
        await store.setNotify(ev.id, settings);
        await store.setReminderDue(ev.id, due);
        if (invitees.length) await invite(ev.id);
      }
      const fresh = method === 'PUT' ? (await store.getNotify(ev.id)) || {} : settings;
      return json(deadlineView(data, fresh, await store.listEmails(ev.id)));
    }

    // POST /api/events/:id/remind: email the invitees who haven't answered, now (My polls' Remind).
    if (parts.length === 3 && parts[2] === 'remind') {
      if (method !== 'POST') return error(405, 'Method not allowed');
      if (!isAdmin) return error(403, 'Only the organizer can send reminders');
      if (!(await mayUseDeadlines())) return error(401, 'Sign in to send reminders');
      const res = await remindNow({ store, env, ev, now: now(), fetchImpl, origin });
      if (res.error) return error(400, res.error);
      return json(res);
    }

    // PUT /api/events/:id/image  { icon, card? }: the poll's own picture, in base64 (src/images.js).
    // DELETE /api/events/:id/image: back to the emoji.
    if (parts.length === 3 && parts[2] === 'image') {
      if (method !== 'PUT' && method !== 'DELETE') return error(405, 'Method not allowed');
      if (!isAdmin) return error(403, "Only the organizer can change the poll's picture");
      if (method === 'DELETE') {
        await store.deleteImage(ev.id);
        return json({ image: null });
      }
      const body = await readJson(request, MAX_IMAGE_BODY);
      const icon = parseImage(body.icon, 'icon');
      const card = body.card == null ? null : parseImage(body.card, 'card');
      const v = await store.setImage(ev.id, { icon, card, now: now() });
      return json({ image: { v, card: !!card, type: icon.type } });
    }

    // POST /api/events/:id/finalize  { start: number | null }
    // A topic poll: { option: id | null }, the option the group goes with (kept as `picked`).
    if (parts.length === 3 && parts[2] === 'finalize' && method === 'POST') {
      if (!isAdmin) return error(403, 'Only the organizer can pick the final time');
      const body = await readJson(request);
      if (isTopicPoll(ev)) {
        const option = body.option === undefined ? body.start : body.option;
        if (option !== null && !buildSlots(ev).includes(option))
          throw new ValidationError('That option is not part of this poll');
        const { id: _id, adminHash, finalStart, createdAt, picked: before, ...data } = ev;
        await store.updateEvent(ev.id, option === null ? data : { ...data, picked: option });
        if (option !== null) {
          count('poll.finalized', kindOf(ev));
          if (option !== before) notify({ ...ev, picked: option }, 'poll.picked', null, null);
        }
        return json({ ok: true, picked: option });
      }
      const { start } = body;
      const before = ev.finalStart;
      if (start !== null && !buildSlots(ev).includes(start)) throw new ValidationError('That time is not part of this poll');
      await store.setFinal(ev.id, start);
      // "Any overlap": the picked time runs to the end of the overlap it starts.
      if (ev.anyLength) {
        const finalEnd = start === null ? null : overlapEnd(ev, buildSlots(ev), await store.listParticipants(ev.id), start);
        const { id: _id, adminHash, finalStart, createdAt, ...data } = ev;
        await store.updateEvent(ev.id, { ...data, finalEnd });
        Object.assign(ev, { finalStart: start, finalEnd });
      }
      if (start !== null) {
        count('poll.finalized', kindOf(ev));
        await emailTheDate(ev, start);
        if (start !== before) {
          pushTheDate(ev, before != null);
          notify({ ...ev, finalStart: start }, 'poll.picked', null, null);
        }
      }
      return json({ ok: true, finalStart: start });
    }

    if (parts[2] !== 'participants') return error(404, 'Not found');
    const slots = buildSlots(ev);

    // PUT /api/events/:id/participants/:pid/push  { push: subscription } | { pushRemove: endpoint }
    // A guest's phone, told when the date is picked. With their own edit token.
    if (parts.length === 5 && parts[4] === 'push' && method === 'PUT') {
      const p = await store.getParticipant(ev.id, parts[3]);
      if (!p) return error(404, 'Response not found');
      if (!(await tokenMatches(request.headers.get('x-edit-token'), p.editHash)))
        return error(403, 'You can only change your own notifications');
      if (!pushEnabled(env)) throw new ValidationError("Notifications on your phone aren't set up on this server");
      const body = await readJson(request);
      const settings = (await store.getNotify(ev.id)) || {};
      let list = settings.guestPush || [];
      let added = null;
      if (body.push) {
        try {
          added = checkSubscription(body.push);
        } catch (e) {
          throw new ValidationError(e.message);
        }
        list = list.filter((x) => x.endpoint !== added.endpoint);
        const theirs = list.filter((x) => x.pid === p.id);
        if (theirs.length >= MAX_PUSH_DEVICES) list = list.filter((x) => x !== theirs[0]);
        list = [...list, { ...added, pid: p.id }].slice(-MAX_GUEST_DEVICES);
      }
      if (typeof body.pushRemove === 'string') list = list.filter((x) => !(x.pid === p.id && x.endpoint === body.pushRemove));
      await store.setNotify(ev.id, { ...settings, guestPush: list });
      if (added) {
        count('push.guest', {});
        const hello = {
          title: ev.title,
          body: `You'll get a notification here when the date ${ev.finalStart == null ? 'is picked' : 'changes'}.`,
          url: `${origin}/e/${ev.id}`,
          tag: ev.id,
        };
        waitUntil(sendPush(added, hello, env, { fetchImpl, now: now() }).catch((e) => console.error('push failed', e)));
      }
      return json({ ok: true });
    }

    // After the deadline, only the organizer can answer (src/deadline.js).
    if (parts[2] === 'participants' && (method === 'POST' || method === 'PUT') && !isAdmin && isClosed(ev, now()))
      return error(403, `Answers closed on ${closesLabel(ev)}.`);

    // POST /api/events/:id/participants
    if (parts.length === 3 && method === 'POST') {
      if (!(await allowed('answer'))) return error(429, TOO_FAST);
      const body = await readJson(request);
      const name = normalizeName(body.name);
      const availability = checkSingle(ev, normalizeAvailability(body.availability, slots));
      const copyTo = normalizeEmail(body.copyTo);
      const email = participantEmail(ev, body);
      if ((await store.countParticipants(ev.id)) >= LIMITS.participants)
        throw new ValidationError('This poll has reached the participant limit');
      const id = randomId(10);
      const editToken = randomId(24);
      await store.insertParticipant({
        id,
        eventId: ev.id,
        name,
        availability,
        editHash: await sha256(editToken),
        now: now(),
      });
      if (email) await store.setParticipantEmail(ev.id, id, email);
      await sendCopy(ev, copyTo, { participantId: id, editToken, name, availability });
      // The organizer's first answer (sent with their link) is theirs: they aren't told about it, and
      // the poll can still be changed until someone else answers.
      if (isAdmin && !ev.hostId) {
        const { id: _id, adminHash, finalStart, createdAt, ...data } = ev;
        await store.updateEvent(ev.id, { ...data, hostId: id });
      } else {
        notify(ev, 'response.created', id, name);
        count('answer.created', { ...kindOf(ev), copy: copyTo ? 'yes' : 'no' });
        // Signed in, it's kept with the account: My polls lists it under Answered.
        if (!isAdmin) await keepWithAccount('answer', id);
      }
      return json({ id, editToken }, 201);
    }

    // PUT|DELETE /api/events/:id/participants/:pid
    if (parts.length === 4) {
      const p = await store.getParticipant(ev.id, parts[3]);
      if (!p) return error(404, 'Response not found');
      const isHost = p.id === ev.hostId;
      // The organizer link also covers the organizer's own answer, so it can be changed from any device.
      const byLink = await tokenMatches(request.headers.get('x-edit-token'), p.editHash);
      const isOwner = byLink || (isAdmin && isHost) || (!isHost && (await answerByAccount(ev.id)) === p.id);
      if (method === 'PUT') {
        if (!isOwner) return error(403, 'You can only edit your own response');
        const body = await readJson(request);
        const name = normalizeName(body.name);
        const availability = checkSingle(ev, normalizeAvailability(body.availability, slots));
        const copyTo = normalizeEmail(body.copyTo);
        const email = isHost ? null : participantEmail(ev, body);
        await store.updateParticipant({ id: p.id, eventId: ev.id, name, availability, now: now() });
        // Changed with its link while signed in: from now on it's with the account too.
        if (byLink && !isHost) await keepWithAccount('answer', p.id);
        // An answer sent with an email field sets it, or takes it away when left empty.
        if (!isHost && 'email' in body) await store.setParticipantEmail(ev.id, p.id, email);
        const editToken = request.headers.get('x-edit-token');
        if (editToken) await sendCopy(ev, copyTo, { participantId: p.id, editToken, name, availability });
        // The organizer isn't told about their own answer.
        if (!isHost) {
          notify(ev, 'response.updated', p.id, name);
          count('answer.updated', kindOf(ev));
        }
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        if (!isOwner && !isAdmin) return error(403, 'You can only remove your own response');
        await store.deleteParticipant(ev.id, p.id);
        // Their phones aren't told about the date any more.
        const settings = await store.getNotify(ev.id);
        if (settings?.guestPush?.some((x) => x.pid === p.id))
          await store.setNotify(ev.id, { ...settings, guestPush: settings.guestPush.filter((x) => x.pid !== p.id) });
        notify(ev, 'response.deleted', p.id, p.name);
        count('answer.deleted', kindOf(ev));
        return json({ ok: true });
      }
      return error(405, 'Method not allowed');
    }

    return error(404, 'Not found');
  } catch (e) {
    if (e instanceof ValidationError) return error(400, e.message);
    if (e instanceof AiKeyError || e instanceof AiUnavailableError) {
      // Why Anthropic said no, in the Worker's logs and the usage stats, so a broken server key or
      // model shows up. Counted even for browsers that opt out: it's about the server, not them.
      const failed = aiFailure(e);
      if (failed) {
        const key = ownKey ? 'own' : 'server';
        console.error('AI request failed', JSON.stringify({ key, ...failed }));
        waitUntil(recordUsage(store, env, now(), 'ai.failed', { key, reason: failed.reason }));
      }
    }
    if (e instanceof AiKeyError)
      return error(ownKey ? 400 : 503, ownKey ? e.message : "The AI couldn't respond. Try again later.");
    if (e instanceof AiUnavailableError) {
      return error(503, e.message);
    }
    console.error(e);
    return error(500, 'Something went wrong');
  }
}
