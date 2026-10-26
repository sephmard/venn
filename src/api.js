// HTTP API built on web-standard Request/Response, shared by the Worker and the Node server.

import { LIMITS, ValidationError, allDaySpan, buildIcs, isValidTimeZone, buildSlots, meetingEnd } from '../public/core.js';
import { normalizeAvailability, normalizeEventInput, normalizeName } from './validate.js';
import { SECURITY_HEADERS } from './security-headers.js';
import {
  MAX_COPIES_PER_ANSWER,
  MAX_COPIES_PER_POLL,
  answerCopyEmail,
  answerLines,
  buildSummary,
  emailEnabled,
  normalizeEmail,
  notifyResponse,
  pollReadyEmail,
  sendEmail,
  sendWebhook,
  validateWebhookUrl,
} from './notify.js';
import { AiUnavailableError, aiEnabled, allowAiRequest, answerForMe, draftPoll, summarize, writeMessage } from './ai.js';

const MAX_BODY = 200_000;
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

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const error = (status, message) => json({ error: message }, status);

async function readJson(request) {
  // Only accept real JSON requests. Browsers can't send these cross-site without CORS, which we don't allow.
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json'))
    throw new ValidationError('Requests must be sent as JSON');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new ValidationError('Request is too large');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new ValidationError('Invalid JSON');
  }
}

/** The organizer's privacy choices for a poll. Only the ones switched on are stored. */
const PRIVACY = ['requireEmail', 'hideNames', 'hideResults'];

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
function publicEvent(ev, participants, { isAdmin, ownHash = null, emails = new Map() }) {
  const { adminHash, ...rest } = ev;
  const own = (p) => ownHash !== null && p.editHash === ownHash;
  const visible = isAdmin || !ev.hideResults ? participants : participants.filter(own);
  let guest = 0;
  const list = visible.map(({ editHash, ...p }) => {
    if (isAdmin || own({ editHash })) return emails.has(p.id) ? { ...p, email: emails.get(p.id) } : p;
    guest += 1;
    return ev.hideNames ? { ...p, name: `Guest ${guest}` } : p;
  });
  return {
    ...rest,
    slots: buildSlots(ev),
    isAdmin,
    participants: list,
    ...(visible !== participants && { responses: participants.length }),
  };
}

/** The email someone answers with, when the organizer asks everyone for one. */
function participantEmail(ev, body) {
  if (!ev.requireEmail) return null;
  const email = normalizeEmail(body.email);
  if (!email) throw new ValidationError('Add your email. The organizer asked everyone for one.');
  return email;
}

/** What the organizer sees about their notification settings. Hashes and tokens stay on the server. */
function notifyView(settings, env) {
  const s = settings || {};
  return {
    emailAvailable: emailEnabled(env),
    email: s.email || null,
    webhookUrl: s.webhookUrl || null,
    webhookSecret: s.webhookUrl ? s.webhookSecret : null,
    lastDelivery: s.lastDelivery || {},
  };
}

/** Point the organizer's notifications at an email address, or turn them off with an empty one. */
function setNotifyEmail(settings, value, env) {
  const email = normalizeEmail(value);
  if (email && !emailEnabled(env)) throw new ValidationError("Email notifications aren't set up on this server");
  settings.email = email;
  if (email) settings.unsubscribeToken ||= randomId(24);
  // From before emails needed no confirmation.
  delete settings.emailConfirmed;
  delete settings.confirmHash;
  delete settings.confirmationsSent;
}

export async function handleApi(
  request,
  store,
  { now = Date.now, env = {}, waitUntil = (p) => p, fetchImpl = fetch, resolveHost, clientIp = '', anthropic, aiWindows } = {},
) {
  const url = new URL(request.url);
  const parts = url.pathname
    .replace(/^\/api\/?/, '')
    .split('/')
    .filter(Boolean);
  const method = request.method;

  const origin = url.origin;
  // Tell the organizer (if they asked) once the response is safely stored. Never blocks the reply.
  const notify = (ev, kind, participantId, name) =>
    waitUntil(notifyResponse({ store, env, fetchImpl, now, origin, ev, kind, participantId, name }));

  /**
   * Email someone a copy of the answer they just saved, if they gave an address. The address is
   * used for this one email and never stored. Copies are counted, so a poll can't be used to
   * flood an inbox.
   */
  async function sendCopy(ev, to, { participantId, editToken, name, availability }) {
    if (!to || !emailEnabled(env)) return;
    const settings = (await store.getNotify(ev.id)) || {};
    const copies = { ...(settings.copies || {}) };
    const total = Object.values(copies).reduce((a, b) => a + b, 0);
    if ((copies[participantId] || 0) >= MAX_COPIES_PER_ANSWER || total >= MAX_COPIES_PER_POLL) return;
    copies[participantId] = (copies[participantId] || 0) + 1;
    await store.setNotify(ev.id, { ...settings, copies });
    const pollUrl = `${origin}/e/${ev.id}`;
    const msg = answerCopyEmail({
      title: ev.title,
      name,
      lines: answerLines(ev, availability),
      pollUrl,
      editUrl: `${pollUrl}#edit=${participantId}.${editToken}`,
      seeAnswers: !ev.hideResults,
    });
    waitUntil(sendEmail(env, { to, ...msg }, { fetchImpl }).catch((e) => console.error('answer copy failed', e)));
  }

  try {
    // GET /api/config — which optional features this server has switched on
    if (parts.length === 1 && parts[0] === 'config' && method === 'GET') {
      return json({
        email: emailEnabled(env),
        ai: aiEnabled(env),
        // OAuth client IDs are public by design; they only identify the app to Google/Microsoft.
        calendars: {
          google: env.GOOGLE_CLIENT_ID || null,
          microsoft: env.MICROSOFT_CLIENT_ID || null,
          microsoftTenant: env.MICROSOFT_TENANT || 'common',
        },
      });
    }

    // Every AI endpoint: switched on, and rate limited per visitor (each call costs money).
    const isAi = (parts[0] === 'ai' && parts.length === 2) || (parts[0] === 'events' && parts[2] === 'ai' && parts.length === 4);
    if (isAi) {
      if (method !== 'POST') return error(405, 'Method not allowed');
      if (!aiEnabled(env)) return error(404, "AI features aren't turned on for this server");
      if (!(await allowAiRequest(env, clientIp, now(), aiWindows)))
        return error(429, "You're going a bit fast. Try again in a minute.");
    }

    // POST /api/ai/draft-poll  { prompt, timezone }
    if (isAi && parts[0] === 'ai' && parts[1] === 'draft-poll') {
      const { prompt, timezone } = await readJson(request);
      if (!isValidTimeZone(timezone)) throw new ValidationError('Unknown time zone');
      return json(await draftPoll(env, { prompt, timezone }, { now: now(), anthropic }));
    }

    // POST /api/events
    if (parts.length === 1 && parts[0] === 'events' && method === 'POST') {
      const body = await readJson(request);
      const event = applyPrivacy(normalizeEventInput(body), body);
      const notifyEmail = body.notifyEmail ? normalizeEmail(body.notifyEmail) : null;
      if (notifyEmail && !emailEnabled(env)) throw new ValidationError("Email notifications aren't set up on this server");
      const id = randomId(10);
      const adminToken = randomId(24);
      await store.createEvent({ id, event, adminHash: await sha256(adminToken), now: now() });
      if (notifyEmail) {
        // No confirmation step: the organizer gets their poll's link straight away, then an email per answer.
        const settings = { emailsSent: 1 };
        setNotifyEmail(settings, notifyEmail, env);
        await store.setNotify(id, settings);
        const msg = pollReadyEmail({
          title: event.title,
          pollUrl: `${origin}/e/${id}`,
          unsubscribeUrl: `${origin}/e/${id}#unsubscribe=${settings.unsubscribeToken}`,
        });
        waitUntil(sendEmail(env, { to: notifyEmail, ...msg }, { fetchImpl }).catch((e) => console.error('poll email failed', e)));
      }
      return json({ id, adminToken }, 201);
    }

    if (parts[0] !== 'events' || !parts[1]) return error(404, 'Not found');
    const ev = await store.getEvent(parts[1]);
    if (!ev) return error(404, 'This poll does not exist or was deleted');
    const isAdmin = await tokenMatches(request.headers.get('x-admin-token'), ev.adminHash);

    // GET|DELETE /api/events/:id
    if (parts.length === 2) {
      if (method === 'GET') {
        // Sending your edit token gets your own answer back, even when the organizer hides answers.
        const editToken = request.headers.get('x-edit-token');
        const ownHash = editToken ? await sha256(editToken) : null;
        const emails = isAdmin || ownHash ? await store.listEmails(ev.id) : undefined;
        return json(publicEvent(ev, await store.listParticipants(ev.id), { isAdmin, ownHash, emails }));
      }
      if (method === 'DELETE') {
        if (!isAdmin) return error(403, 'Only the organizer can delete this poll');
        await store.deleteEvent(ev.id);
        return json({ ok: true });
      }
      return error(405, 'Method not allowed');
    }

    // GET /api/events/:id/event.ics
    if (parts.length === 3 && parts[2] === 'event.ics' && method === 'GET') {
      if (ev.finalStart == null) return error(404, 'No time has been picked yet');
      const end = meetingEnd(ev, ev.finalStart);
      const body = buildIcs({
        id: ev.id,
        title: ev.title,
        description: ev.description,
        location: ev.location,
        start: ev.finalStart,
        end,
        allDay: allDaySpan(ev.finalStart, end, ev.timezone),
        url: `${url.origin}/e/${ev.id}`,
      });
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
      // (not a GET link) means email scanners that pre-open links can't unsubscribe.
      if (action === 'unsubscribe' && parts.length === 4 && method === 'POST') {
        const { token } = await readJson(request);
        if (!settings.unsubscribeToken || typeof token !== 'string' || !timingSafeEqual(token, settings.unsubscribeToken))
          throw new ValidationError('This unsubscribe link is invalid');
        await store.setNotify(ev.id, { ...settings, email: null });
        return json({ ok: true });
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
        await store.setNotify(ev.id, settings);
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

    // PUT /api/events/:id/settings  { requireEmail?, hideNames?, hideResults? }
    if (parts.length === 3 && parts[2] === 'settings' && method === 'PUT') {
      if (!isAdmin) return error(403, 'Only the organizer can change these settings');
      const { id: _id, adminHash, finalStart, createdAt, ...data } = ev;
      const next = applyPrivacy(data, await readJson(request));
      await store.updateEvent(ev.id, next);
      return json(Object.fromEntries(PRIVACY.map((k) => [k, !!next[k]])));
    }

    // POST /api/events/:id/finalize  { start: number | null }
    if (parts.length === 3 && parts[2] === 'finalize' && method === 'POST') {
      if (!isAdmin) return error(403, 'Only the organizer can pick the final time');
      const { start } = await readJson(request);
      if (start !== null && !buildSlots(ev).includes(start)) throw new ValidationError('That time is not part of this poll');
      await store.setFinal(ev.id, start);
      return json({ ok: true, finalStart: start });
    }

    if (parts[2] !== 'participants') return error(404, 'Not found');
    const slots = buildSlots(ev);

    // POST /api/events/:id/participants
    if (parts.length === 3 && method === 'POST') {
      const body = await readJson(request);
      const name = normalizeName(body.name);
      const availability = normalizeAvailability(body.availability, slots);
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
      notify(ev, 'response.created', id, name);
      return json({ id, editToken }, 201);
    }

    // PUT|DELETE /api/events/:id/participants/:pid
    if (parts.length === 4) {
      const p = await store.getParticipant(ev.id, parts[3]);
      if (!p) return error(404, 'Response not found');
      const isOwner = await tokenMatches(request.headers.get('x-edit-token'), p.editHash);
      if (method === 'PUT') {
        if (!isOwner) return error(403, 'You can only edit your own response');
        const body = await readJson(request);
        const name = normalizeName(body.name);
        const availability = normalizeAvailability(body.availability, slots);
        const copyTo = normalizeEmail(body.copyTo);
        const email = participantEmail(ev, body);
        await store.updateParticipant({ id: p.id, eventId: ev.id, name, availability, now: now() });
        if (email) await store.setParticipantEmail(ev.id, p.id, email);
        await sendCopy(ev, copyTo, {
          participantId: p.id,
          editToken: request.headers.get('x-edit-token'),
          name,
          availability,
        });
        notify(ev, 'response.updated', p.id, name);
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        if (!isOwner && !isAdmin) return error(403, 'You can only remove your own response');
        await store.deleteParticipant(ev.id, p.id);
        notify(ev, 'response.deleted', p.id, p.name);
        return json({ ok: true });
      }
      return error(405, 'Method not allowed');
    }

    return error(404, 'Not found');
  } catch (e) {
    if (e instanceof ValidationError) return error(400, e.message);
    if (e instanceof AiUnavailableError) {
      if (e.cause) console.error('AI request failed', e.cause);
      return error(503, e.message);
    }
    console.error(e);
    return error(500, 'Something went wrong');
  }
}
