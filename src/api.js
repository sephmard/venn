// HTTP API built on web-standard Request/Response, shared by the Worker and the Node server.

import {
  LIMITS,
  ValidationError,
  allDaySpan,
  buildIcs,
  isValidTimeZone,
  buildSlots,
  meetingEnd,
  normalizeAvailability,
  normalizeEventInput,
  normalizeName,
} from '../public/core.js';
import { SECURITY_HEADERS } from './security-headers.js';
import {
  MAX_CONFIRMATIONS,
  buildSummary,
  confirmationEmail,
  emailEnabled,
  normalizeEmail,
  notifyResponse,
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

function publicEvent(ev, participants, isAdmin) {
  const { adminHash, ...rest } = ev;
  return {
    ...rest,
    slots: buildSlots(ev),
    isAdmin,
    participants: participants.map(({ editHash, ...p }) => p),
  };
}

/** What the organizer sees about their notification settings. Hashes and tokens stay on the server. */
function notifyView(settings, env) {
  const s = settings || {};
  return {
    emailAvailable: emailEnabled(env),
    email: s.email || null,
    emailConfirmed: Boolean(s.emailConfirmed),
    webhookUrl: s.webhookUrl || null,
    webhookSecret: s.webhookUrl ? s.webhookSecret : null,
    lastDelivery: s.lastDelivery || {},
  };
}

/**
 * Point notifications at a new email address. Returns a function that sends the confirmation
 * email, so callers can choose whether to wait for it.
 */
async function changeEmail(settings, value, { env, origin, ev, fetchImpl }) {
  const email = normalizeEmail(value);
  if (email === (settings.email || null)) return null;
  if (!email) {
    Object.assign(settings, { email: null, emailConfirmed: false, confirmHash: null });
    return null;
  }
  if (!emailEnabled(env)) throw new ValidationError("Email notifications aren't set up on this server");
  if ((settings.confirmationsSent || 0) >= MAX_CONFIRMATIONS)
    throw new ValidationError('Too many confirmation emails for this poll. Try a webhook instead.');
  const token = randomId(24);
  Object.assign(settings, {
    email,
    emailConfirmed: false,
    confirmHash: await sha256(token),
    confirmationsSent: (settings.confirmationsSent || 0) + 1,
    unsubscribeToken: settings.unsubscribeToken || randomId(24),
  });
  const msg = confirmationEmail(ev.title, `${origin}/e/${ev.id}#confirm-email=${token}`);
  return () => sendEmail(env, { to: email, ...msg }, { fetchImpl });
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
      const event = normalizeEventInput(body);
      const notifyEmail = body.notifyEmail ? normalizeEmail(body.notifyEmail) : null;
      if (notifyEmail && !emailEnabled(env)) throw new ValidationError("Email notifications aren't set up on this server");
      const id = randomId(10);
      const adminToken = randomId(24);
      await store.createEvent({ id, event, adminHash: await sha256(adminToken), now: now() });
      if (notifyEmail) {
        const settings = {};
        const send = await changeEmail(settings, notifyEmail, { env, origin, ev: { id, ...event }, fetchImpl });
        await store.setNotify(id, settings);
        waitUntil(send().catch((e) => console.error('confirmation email failed', e)));
      }
      return json({ id, adminToken }, 201);
    }

    if (parts[0] !== 'events' || !parts[1]) return error(404, 'Not found');
    const ev = await store.getEvent(parts[1]);
    if (!ev) return error(404, 'This poll does not exist or was deleted');
    const isAdmin = await tokenMatches(request.headers.get('x-admin-token'), ev.adminHash);

    // GET|DELETE /api/events/:id
    if (parts.length === 2) {
      if (method === 'GET') return json(publicEvent(ev, await store.listParticipants(ev.id), isAdmin));
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
      // (not a GET link) means email scanners that pre-open links can't confirm or unsubscribe.
      if ((action === 'confirm' || action === 'unsubscribe') && parts.length === 4 && method === 'POST') {
        const { token } = await readJson(request);
        if (action === 'confirm') {
          if (!settings.confirmHash || !(await tokenMatches(token, settings.confirmHash)))
            throw new ValidationError('This confirmation link is invalid or has expired');
          await store.setNotify(ev.id, { ...settings, emailConfirmed: true, confirmHash: null });
          return json({ ok: true, email: settings.email });
        }
        if (!settings.unsubscribeToken || typeof token !== 'string' || !timingSafeEqual(token, settings.unsubscribeToken))
          throw new ValidationError('This unsubscribe link is invalid');
        await store.setNotify(ev.id, { ...settings, email: null, emailConfirmed: false, confirmHash: null });
        return json({ ok: true });
      }

      if (!isAdmin) return error(403, 'Only the organizer can change notifications');

      if (parts.length === 3 && method === 'GET') return json(notifyView(settings, env));

      if (parts.length === 3 && method === 'PUT') {
        const body = await readJson(request);
        const send = 'email' in body ? await changeEmail(settings, body.email, { env, origin, ev, fetchImpl }) : null;
        if ('webhookUrl' in body) {
          const webhookUrl = await validateWebhookUrl(body.webhookUrl, { resolveHost });
          if (webhookUrl && (webhookUrl !== settings.webhookUrl || !settings.webhookSecret))
            settings.webhookSecret = `whsec_${randomId(32)}`;
          settings.webhookUrl = webhookUrl;
          if (!webhookUrl) settings.webhookSecret = null;
        }
        if (send) {
          try {
            await send();
          } catch {
            throw new ValidationError("Couldn't send the confirmation email. Check the address and try again.");
          }
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
        await store.updateParticipant({
          id: p.id,
          eventId: ev.id,
          name,
          availability: normalizeAvailability(body.availability, slots),
          now: now(),
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
