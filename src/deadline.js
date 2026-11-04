// A deadline for answers, for organizers who are signed in (where the server has sign-in): guests
// see when answers close, and after that only the organizer can answer. Date polls and votes alike.
// The organizer can list who they invited (the poll then asks everyone's email, which is how Venn
// knows who answered): Venn emails those who haven't answered yet, as often as the organizer chose and once more the day
// before, and when answers close it emails the organizer the best time (or option), ready to pick. Sent by the
// hourly run (src/worker.js's cron trigger, and a timer in server.js); only when the server sends email.
//
// The deadline is part of the poll (guests see it). Who was invited, and their reminders, live with
// the organizer's private settings (store.getNotify), so only the organizer ever sees those emails.

import { ValidationError, buildSlots, rankTimes } from '../public/core.js';
import {
  answersClosedEmail,
  deadlineReminderEmail,
  emailEnabled,
  sendEmail,
  unsubscribeHeaders,
  unsubscribeLink,
} from './notify.js';
import { setLabel } from './preview.js';
import { whiteLabelOf } from './brands.js';
import { mayEmail, recipientCap } from './recipients.js';
import { publicOrigin } from './site.js';
import { normalizeInvitees } from './invites.js';

export { MAX_INVITEES } from './invites.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How often invitees who haven't answered get a reminder, in days; 0 is only the day before. */
export const REMIND_EVERY = [0, 1, 2, 3];
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
export const isClosed = (ev, now) => ev.deadline != null && !isDecided(ev) && now >= ev.deadline;

/** Whether the organizer has picked: the date, or a vote's option. */
export const isDecided = (ev) => ev.finalStart != null || ev.picked != null;

/**
 * Check what the organizer sent: `{ deadline, remindEvery, invitees }`, each optional. Invitees don't
 * need a deadline (Venn emails them the poll, src/invites.js); reminders need both. Invitees make
 * the poll ask everyone's email (applyDeadline), since that's how Venn knows who answered. Returns
 * the cleaned values.
 */
export function normalizeDeadline(body, ev, now) {
  const invitees = normalizeInvitees(body.invitees);
  const deadline = body.deadline ?? null;
  if (deadline === null) return { deadline: null, remindEvery: null, invitees };
  if (!Number.isFinite(deadline) || deadline < now + MIN_AHEAD || deadline > now + MAX_AHEAD)
    throw new ValidationError('Choose when answers close: at least an hour from now, and within 30 days');
  const remindEvery = body.remindEvery ?? null;
  if (remindEvery !== null && !REMIND_EVERY.includes(remindEvery))
    throw new ValidationError('Remind every day, every 2 or 3 days, or only the day before');
  return { deadline, remindEvery: invitees.length ? remindEvery : null, invitees };
}

/**
 * Put a checked deadline and invite list on poll `ev` (its data, saved by the caller) and on its
 * private `settings` (also saved by the caller): invitees already on the list keep their reminders,
 * unsubscribe links and whether they were sent the poll. `origin` is where the site lives, for the
 * links in emails. Returns when the poll is next due a look (store.setReminderDue).
 */
export function applyDeadline(ev, settings, { deadline, remindEvery, invitees }, { now, origin }) {
  if (deadline === null) delete ev.deadline;
  else ev.deadline = deadline;
  if (deadline === null && !invitees.length) {
    delete settings.remind;
    return null;
  }
  // Reminders go to those who haven't answered, told apart by the email they answer with.
  if (invitees.length) ev.requireEmail = true;
  const before = new Map((settings.remind?.invitees || []).map((i) => [i.email, i]));
  settings.remind = {
    every: deadline === null ? null : remindEvery,
    origin,
    since: settings.remind?.since ?? now,
    lastRound: settings.remind?.lastRound ?? null,
    lastSent: deadline !== null && settings.remind?.deadline === deadline ? !!settings.remind?.lastSent : false,
    deadline,
    ...(settings.remind?.invitesSent && { invitesSent: settings.remind.invitesSent }),
    ...(settings.remind?.lastManual && { lastManual: settings.remind.lastManual }),
    // `invited: null`: due the poll by email (src/invites.js). Lists from before that have no `invited`.
    invitees: invitees.map(
      (email) => before.get(email) || { id: `i${token().slice(0, 8)}`, token: token(), email, sent: 0, invited: null },
    ),
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
      invited: !!i.invited,
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

/** One round of reminders to the invitees who haven't answered: { sent, invitees } (with their counts). */
async function remindRound({ store, env, fetchImpl, ev, r, site, last, mail, now = Date.now() }) {
  const pollUrl = `${site}/e/${ev.id}`;
  const answered = new Set((await store.listEmails(ev.id)).values());
  const whiteLabel = await whiteLabelOf(store, ev);
  const invitees = [];
  let sent = 0;
  let capped = 0;
  for (const i of r.invitees || []) {
    if (mail && !i.stopped && !answered.has(i.email) && i.sent < MAX_REMINDERS) {
      const unsubscribeToken = `${i.id}.${i.token}`;
      const msg = deadlineReminderEmail({
        title: ev.title,
        organizer: ev.organizer,
        closes: closesLabel(ev),
        pollUrl,
        unsubscribeUrl: `${pollUrl}#unsubscribe=${unsubscribeToken}`,
        answerUrl: invitedUrl(pollUrl, i.email),
        last,
        retro: ev.retro,
        whiteLabel,
      });
      const headers = unsubscribeHeaders(unsubscribeLink(site, ev.id, unsubscribeToken));
      // Past the poll's daily cap (src/recipients.js): not sent, and not counted as a reminder.
      if (!(await mayEmail(store, env, ev.id, i.email, now))) {
        invitees.push(i);
        capped++;
        continue;
      }
      try {
        await sendEmail(env, { to: i.email, ...msg, headers }, { fetchImpl });
        invitees.push({ ...i, sent: i.sent + 1 });
        sent++;
        continue;
      } catch (e) {
        console.error('reminder failed', e);
      }
    }
    invitees.push(i);
  }
  return { sent, invitees, capped };
}

/** The poll's link for one invitee: their email goes in the fragment, ready in the answer form. */
export const invitedUrl = (pollUrl, email) => `${pollUrl}#invited=${encodeURIComponent(email)}`;

/** Who a poll can still remind by email: invitees who haven't answered, stopped or had them all. */
export async function waitingInvitees(store, ev, settings) {
  const answered = new Set((await store.listEmails(ev.id)).values());
  return (settings?.remind?.invitees || []).filter((i) => !i.stopped && !answered.has(i.email) && i.sent < MAX_REMINDERS);
}

/**
 * The organizer's "Remind now" (My polls): one round of reminders straight away, to invitees who
 * haven't answered, at most once every 12 hours. Returns { sent }, or throws a ValidationError-like message.
 */
export async function remindNow({ store, env = {}, ev, now = Date.now(), fetchImpl = fetch, origin }) {
  if (!emailEnabled(env)) return { error: "Emails aren't turned on for this server" };
  if (isDecided(ev)) return { error: ev.finalStart != null ? 'The date is already picked' : 'The vote is already decided' };
  if (isClosed(ev, now)) return { error: 'Answers have closed' };
  const settings = (await store.getNotify(ev.id)) || {};
  const r = settings.remind;
  if (!r?.invitees?.length) return { error: 'This poll has no invite list to remind' };
  if (r.lastManual && now - r.lastManual < 12 * HOUR) return { error: 'Reminders went out less than 12 hours ago' };
  const site = (publicOrigin(env) || r.origin || origin || '').replace(/\/+$/, '');
  const round = await remindRound({ store, env, fetchImpl, ev, r, site, last: false, mail: true, now });
  if (!round.sent)
    return {
      error: round.capped
        ? `This poll has emailed ${recipientCap(env)} different people today, its limit for a day. Try again tomorrow.`
        : 'Everyone invited has answered or stopped reminders',
    };
  await store.setNotify(ev.id, { ...settings, remind: { ...r, invitees: round.invitees, lastManual: now } });
  return { sent: round.sent };
}

/**
 * Send what's due (reminders, and the organizer's "answers are closed" email) for every poll whose
 * time has come, and return how many emails went. Each poll's next look is booked as it goes.
 */
export async function sendDeadlines({ store, env = {}, now = Date.now(), fetchImpl = fetch } = {}) {
  /** Where the organizer hears that answers are in: the email they gave, or their account's. */
  const organizerEmail = async (id, settings) => {
    if (settings.email || settings.accountEmailStopped) return settings.email || null;
    const owner = await store.ownerOf('poll', id);
    return (owner && (await store.getUser(owner))?.email) || null;
  };
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
    const site = (publicOrigin(env) || r.origin || '').replace(/\/+$/, '');
    const pollUrl = `${site}/e/${id}`;
    const mail = emailEnabled(env) && site;
    let n = 0;
    if (isClosed(ev, now)) {
      // Answers are in: tell the organizer, once, with the best time (or option) to pick.
      const to = mail && !isDecided(ev) ? await organizerEmail(id, settings) : null;
      if (to) {
        if (!settings.unsubscribeToken) settings.unsubscribeToken = token();
        const people = await store.listParticipants(id);
        const [best] = people.length ? rankTimes(ev, buildSlots(ev), people, 1) : [];
        const topic = ev.mode === 'topic';
        const emails = await store.listEmails(id);
        const answeredEmails = new Set(emails.values());
        const waiting = (r.invitees || []).filter((i) => !answeredEmails.has(i.email)).length;
        const others = people.filter((p) => p.id !== ev.hostId).length;
        const unsubscribeUrl = `${pollUrl}#unsubscribe=${settings.unsubscribeToken}`;
        const msg = answersClosedEmail({
          title: ev.title,
          answered: others,
          waiting,
          best: best && best.yes.length + best.ifNeeded.length ? (topic ? best.label : setLabel(ev, best.start)) : null,
          topic,
          pollUrl,
          unsubscribeUrl,
          retro: ev.retro,
        });
        const headers = unsubscribeHeaders(unsubscribeLink(site, id, settings.unsubscribeToken));
        await sendEmail(env, { to, ...msg, headers }, { fetchImpl });
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
      const round = await remindRound({ store, env, fetchImpl, ev, r, site, last: !!last, mail, now });
      n += round.sent;
      Object.assign(r, { invitees: round.invitees, lastRound: now, ...(last && { lastSent: true }) });
    }
    const next = { ...settings, remind: r };
    await store.setNotify(id, next);
    await store.setReminderDue(id, nextDue(ev, next));
    return n;
  }
}
