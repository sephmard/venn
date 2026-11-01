// A deadline for answers, for polls that ask everyone for their email: guests see when answers
// close, and after that only the organizer can answer. The organizer can list who they invited:
// Venn emails those who haven't answered yet, as often as the organizer chose and once more the day
// before, and when answers close it emails the organizer the best time, ready to pick. Sent by the
// hourly run (src/worker.js's cron trigger, and a timer in server.js); only when the server sends email.
//
// The deadline is part of the poll (guests see it). Who was invited, and their reminders, live with
// the organizer's private settings (store.getNotify), so only the organizer ever sees those emails.

import { ValidationError, buildSlots, rankTimes } from '../public/core.js';
import {
  answersClosedEmail,
  deadlineReminderEmail,
  emailEnabled,
  normalizeEmail,
  sendEmail,
  unsubscribeHeaders,
  unsubscribeLink,
} from './notify.js';
import { setLabel } from './preview.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How often invitees who haven't answered get a reminder, in days; 0 is only the day before. */
export const REMIND_EVERY = [0, 1, 2, 3];
export const MAX_INVITEES = 50;
/** No more than this many reminders to anyone, however long the deadline is. */
export const MAX_REMINDERS = 5;
/** A deadline at least this far ahead, and at most this far. */
export const MIN_AHEAD = HOUR;
export const MAX_AHEAD = 30 * DAY;

const token = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(36).padStart(2, '0')).join('');

/** "Fri, Nov 6, 5:00 PM EST": when answers close, in the poll's own time zone. */
export const closesLabel = (ev) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ev.timezone,
    timeZoneName: 'short',
  })
    .format(ev.deadline)
    .replace(/[\u2009\u202f\u00a0]/g, ' ');

/**
 * Whether poll `ev` has stopped taking answers (from anyone but its organizer). Once the date is
 * picked, guests can still say whether they can make it.
 */
export const isClosed = (ev, now) => ev.deadline != null && ev.finalStart == null && now >= ev.deadline;

/**
 * Check what the organizer sent: `{ deadline, remindEvery, invitees }`, each optional. A deadline
 * needs the poll to ask everyone's email (that's how Venn knows who answered); reminders and
 * invitees need a deadline. Returns the cleaned values.
 */
export function normalizeDeadline(body, ev, now) {
  const deadline = body.deadline ?? null;
  if (deadline === null) return { deadline: null, remindEvery: null, invitees: [] };
  if (!ev.requireEmail)
    throw new ValidationError('A deadline needs everyone’s email: turn on “Ask guests for their email” first');
  if (!Number.isFinite(deadline) || deadline < now + MIN_AHEAD || deadline > now + MAX_AHEAD)
    throw new ValidationError('Choose when answers close: at least an hour from now, and within 30 days');
  const remindEvery = body.remindEvery ?? null;
  if (remindEvery !== null && !REMIND_EVERY.includes(remindEvery))
    throw new ValidationError('Remind every day, every 2 or 3 days, or only the day before');
  const list = body.invitees ?? [];
  if (!Array.isArray(list)) throw new ValidationError('Invitees must be a list of emails');
  const invitees = [
    ...new Set(
      list
        .map((e) => {
          try {
            return normalizeEmail(e);
          } catch {
            throw new ValidationError(`Check this email: ${String(e).slice(0, 80)}`);
          }
        })
        .filter(Boolean),
    ),
  ];
  if (invitees.length > MAX_INVITEES) throw new ValidationError(`Invite at most ${MAX_INVITEES} people`);
  return { deadline, remindEvery: invitees.length ? remindEvery : null, invitees };
}

/**
 * Put a checked deadline on poll `ev` (its data, saved by the caller) and on its private `settings`
 * (also saved by the caller): invitees already on the list keep their reminders and unsubscribe
 * links. `origin` is where the site lives, for the links in reminders. Returns when the poll is
 * next due a look (store.setReminderDue).
 */
export function applyDeadline(ev, settings, { deadline, remindEvery, invitees }, { now, origin }) {
  if (deadline === null) {
    delete ev.deadline;
    delete settings.remind;
    return null;
  }
  ev.deadline = deadline;
  const before = new Map((settings.remind?.invitees || []).map((i) => [i.email, i]));
  settings.remind = {
    every: remindEvery,
    origin,
    since: settings.remind?.since ?? now,
    lastRound: settings.remind?.lastRound ?? null,
    lastSent: settings.remind?.deadline === deadline ? !!settings.remind?.lastSent : false,
    deadline,
    invitees: invitees.map((email) => before.get(email) || { id: `i${token().slice(0, 8)}`, token: token(), email, sent: 0 }),
  };
  return nextDue(ev, settings);
}

/** When poll `ev` is next due a look: the next reminder, the day-before one, or the deadline. */
export function nextDue(ev, settings) {
  if (ev.deadline == null) return null;
  const r = settings.remind || {};
  if (r.closedSent) return null;
  const due = [ev.deadline];
  if (r.invitees?.length && r.every != null) {
    if (r.every > 0) due.push((r.lastRound ?? r.since) + r.every * DAY);
    if (!r.lastSent) due.push(ev.deadline - DAY);
  }
  return Math.min(...due);
}

/** Organizer-only: who was invited, whether they've answered, and how many reminders went. */
export function deadlineView(ev, settings, emails) {
  const answered = new Set(emails.values());
  const r = settings.remind || {};
  return {
    deadline: ev.deadline ?? null,
    remindEvery: r.every ?? null,
    invitees: (r.invitees || []).map((i) => ({
      email: i.email,
      answered: answered.has(i.email),
      reminded: i.sent,
      stopped: !!i.stopped,
    })),
  };
}

/**
 * The settings with reminders stopped for the invitee this unsubscribe token belongs to ("id.token"
 * from their reminder email), or null if it's no one's.
 */
export function stopReminders(settings, value, timingSafeEqual) {
  const [id, secret = ''] = String(value).split('.');
  const list = settings.remind?.invitees || [];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0 || !timingSafeEqual(secret, list[i].token)) return null;
  const invitees = list.map((x, n) => (n === i ? { ...x, stopped: true } : x));
  return { ...settings, remind: { ...settings.remind, invitees } };
}

/**
 * Send what's due (reminders, and the organizer's "answers are closed" email) for every poll whose
 * time has come, and return how many emails went. Each poll's next look is booked as it goes.
 */
export async function sendDeadlines({ store, env = {}, now = Date.now(), fetchImpl = fetch } = {}) {
  let sent = 0;
  for (const id of await store.dueReminders(now)) {
    try {
      sent += await handle(id);
    } catch (e) {
      console.error('deadline run failed', id, e);
    }
  }
  return sent;

  async function handle(id) {
    const ev = await store.getEvent(id);
    if (!ev || ev.deadline == null) return (void (await store.setReminderDue(id, null)), 0);
    const settings = (await store.getNotify(id)) || {};
    const r = settings.remind || {};
    const site = (r.origin || env.PUBLIC_URL || '').replace(/\/+$/, '');
    const pollUrl = `${site}/e/${id}`;
    const mail = emailEnabled(env) && site;
    let n = 0;
    if (isClosed(ev, now)) {
      // Answers are in: tell the organizer, once, with the best time to pick.
      if (mail && settings.email && ev.finalStart == null) {
        const people = await store.listParticipants(id);
        const [best] = people.length ? rankTimes(ev, buildSlots(ev), people, 1) : [];
        const emails = await store.listEmails(id);
        const answeredEmails = new Set(emails.values());
        const waiting = (r.invitees || []).filter((i) => !answeredEmails.has(i.email)).length;
        const others = people.filter((p) => p.id !== ev.hostId).length;
        const unsubscribeUrl = `${pollUrl}#unsubscribe=${settings.unsubscribeToken}`;
        const msg = answersClosedEmail({
          title: ev.title,
          answered: others,
          waiting,
          best: best && best.yes.length + best.ifNeeded.length ? setLabel(ev, best.start) : null,
          pollUrl,
          unsubscribeUrl,
          retro: ev.retro,
        });
        const headers = unsubscribeHeaders(unsubscribeLink(site, id, settings.unsubscribeToken));
        await sendEmail(env, { to: settings.email, ...msg, headers }, { fetchImpl });
        n++;
      }
      await store.setNotify(id, { ...settings, remind: { ...r, closedSent: true } });
      await store.setReminderDue(id, null);
      return n;
    }
    // Reminders: a round when one's due (every few days, and the day before), to those who haven't answered.
    const periodic = r.every > 0 && now >= (r.lastRound ?? r.since) + r.every * DAY;
    const last = r.every != null && !r.lastSent && now >= ev.deadline - DAY;
    if ((periodic || last) && r.invitees?.length) {
      const answered = new Set((await store.listEmails(id)).values());
      const invitees = [];
      for (const i of r.invitees) {
        if (mail && !i.stopped && !answered.has(i.email) && i.sent < MAX_REMINDERS) {
          const unsubscribeToken = `${i.id}.${i.token}`;
          const msg = deadlineReminderEmail({
            title: ev.title,
            organizer: ev.organizer,
            closes: closesLabel(ev),
            pollUrl,
            unsubscribeUrl: `${pollUrl}#unsubscribe=${unsubscribeToken}`,
            last,
            retro: ev.retro,
          });
          const headers = unsubscribeHeaders(unsubscribeLink(site, id, unsubscribeToken));
          try {
            await sendEmail(env, { to: i.email, ...msg, headers }, { fetchImpl });
            invitees.push({ ...i, sent: i.sent + 1 });
            n++;
            continue;
          } catch (e) {
            console.error('reminder failed', e);
          }
        }
        invitees.push(i);
      }
      Object.assign(r, { invitees, lastRound: now, ...(last && { lastSent: true }) });
    }
    const next = { ...settings, remind: r };
    await store.setNotify(id, next);
    await store.setReminderDue(id, nextDue(ev, next));
    return n;
  }
}
