// Emailing a poll to people: the organizer lists their emails (on the create page, or later in
// organizer tools) and Venn sends each one the poll, once. The same list gets the deadline's reminders
// (src/deadline.js), and the poll asks everyone's email so Venn knows who answered.
//
// For organizers who are signed in (where the server has sign-in), and only when the server sends
// email. Venn sends mail in the organizer's name to addresses nobody confirmed, so it's bounded: at
// most MAX_INVITEES on a poll, MAX_INVITE_EMAILS invitations per poll ever (removing and adding people
// again doesn't send more), INVITES_PER_DAY per account, a one-tap stop in every email that also stops
// reminders, and nothing the organizer writes beyond the poll's own name and title.

import { ValidationError, isTopicPoll } from '../public/core.js';
import { whiteLabelOf } from './brands.js';
import { mayEmail } from './recipients.js';
import { publicOrigin } from './site.js';
import { closesLabel, invitedUrl, isClosed, isDecided } from './deadline.js';
import { emailEnabled, inviteEmail, normalizeEmail, sendEmail, unsubscribeHeaders, unsubscribeLink } from './notify.js';

export const MAX_INVITEES = 50;
/** Invitations one poll sends, ever. */
export const MAX_INVITE_EMAILS = 100;
/** Invitations one account sends a day, across its polls. */
export const INVITES_PER_DAY = 200;

const day = (now) => new Date(now).toISOString().slice(0, 10);

/** The organizer's list of emails, cleaned and without repeats. Throws on one that isn't an email. */
export function normalizeInvitees(list = []) {
  if (list == null) return [];
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
  return invitees;
}

/** Invitees still due the poll: new on the list, not stopped, and not already answered. */
const due = (invitees, answered) => invitees.filter((i) => i.invited === null && !i.stopped && !answered.has(i.email));

/**
 * Before saving a list: can `count` more invitations go out today, for this account and this poll?
 * Returns a message saying why not, or null. `settings` are the poll's (empty for a new one).
 */
export async function inviteRoom({ store, userId, settings = {}, count, now }) {
  if (!count) return null;
  const pollLeft = MAX_INVITE_EMAILS - (settings.remind?.invitesSent || 0);
  if (count > pollLeft)
    return pollLeft > 0
      ? `This poll can email ${pollLeft} more ${pollLeft === 1 ? 'person' : 'people'}`
      : 'This poll has emailed as many people as it can';
  if (!userId) return null;
  const left = INVITES_PER_DAY - (await store.sendsOn(userId, day(now)));
  if (count > left)
    return left > 0
      ? `You can email ${left} more ${left === 1 ? 'person' : 'people'} today`
      : "You've emailed as many people as you can today. Try again tomorrow.";
  return null;
}

/** How many on a list `invitees` (emails) would get an invitation now. */
export async function newInvitees(store, eventId, settings, invitees) {
  const known = new Map((settings?.remind?.invitees || []).map((i) => [i.email, i]));
  const answered = eventId ? new Set((await store.listEmails(eventId)).values()) : new Set();
  return invitees
    .filter((email) => !known.has(email) || (known.get(email).invited === null && !known.get(email).stopped))
    .filter((email) => !answered.has(email)).length;
}

/**
 * Email the poll to everyone on its list who hasn't had it yet, within the limits above, and note
 * who got it. `userId` is the organizer's account (null without sign-in). Returns how many went.
 */
export async function sendInvites({ store, env = {}, fetchImpl = fetch, id, userId = null, now = Date.now(), origin }) {
  if (!emailEnabled(env)) return 0;
  const ev = await store.getEvent(id);
  if (!ev || isDecided(ev) || isClosed(ev, now)) return 0;
  const settings = (await store.getNotify(id)) || {};
  const r = settings.remind;
  if (!r?.invitees?.length) return 0;
  const site = (publicOrigin(env) || r.origin || origin || '').replace(/\/+$/, '');
  if (!site) return 0;
  const answered = new Set((await store.listEmails(id)).values());
  let room = MAX_INVITE_EMAILS - (r.invitesSent || 0);
  if (userId) room = Math.min(room, INVITES_PER_DAY - (await store.sendsOn(userId, day(now))));
  const pollUrl = `${site}/e/${id}`;
  const closes = ev.deadline != null ? closesLabel(ev) : null;
  const whiteLabel = await whiteLabelOf(store, ev);
  const sentTo = new Set();
  for (const i of due(r.invitees, answered)) {
    if (sentTo.size >= room) break;
    const unsubscribeToken = `${i.id}.${i.token}`;
    const msg = inviteEmail({
      title: ev.title,
      organizer: ev.organizer,
      closes,
      topic: isTopicPoll(ev),
      pollUrl,
      answerUrl: invitedUrl(pollUrl, i.email),
      unsubscribeUrl: `${pollUrl}#unsubscribe=${unsubscribeToken}`,
      retro: ev.retro,
      whiteLabel,
    });
    const headers = unsubscribeHeaders(unsubscribeLink(site, id, unsubscribeToken));
    // Past the poll's daily cap (src/recipients.js), left unsent: it can go out another day.
    if (!(await mayEmail(store, env, id, i.email, now))) continue;
    try {
      await sendEmail(env, { to: i.email, ...msg, headers }, { fetchImpl });
      sentTo.add(i.id);
    } catch (e) {
      console.error('invite failed', e);
    }
  }
  if (!sentTo.size) return 0;
  // Saved on the latest settings, in case the list changed while these went out.
  const latest = (await store.getNotify(id)) || {};
  if (latest.remind?.invitees)
    await store.setNotify(id, {
      ...latest,
      remind: {
        ...latest.remind,
        invitesSent: (latest.remind.invitesSent || 0) + sentTo.size,
        invitees: latest.remind.invitees.map((i) => (sentTo.has(i.id) ? { ...i, invited: now } : i)),
      },
    });
  if (userId) await store.addSends(userId, day(now), sentTo.size);
  return sentTo.size;
}
