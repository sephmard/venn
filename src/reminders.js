// "Time to plan next month's book club?": once the date of a poll that repeats has passed, its
// organizer gets one email with a link to the next one, its dates already moved on. Run every hour
// by the Worker's cron trigger (src/worker.js) and by a timer in the Node server (server.js).
//
// Only when the server sends email and the organizer gave an address for the poll (and hasn't
// stopped the emails). Guests are never emailed. Each poll is handled once (store.markReminded),
// and not at all when the next one was already planned from it.

import { isOptionsPoll, isPartsPoll, meetingEnd } from '../public/core.js';
import { REPEATS, nextLabel } from '../public/repeat.js';
import { MAX_ORGANIZER_EMAILS, emailEnabled, reminderEmail, sendEmail } from './notify.js';
import { recordUsage } from './usage.js';

const DAY = 86_400_000;
// Polls whose date is older than this are left alone: a reminder weeks late isn't helpful.
export const REMINDER_WINDOW_MS = 21 * DAY;

/** The create page for the next one: this poll copied, its dates moved on one cycle. */
export const planNextUrl = (origin, ev) =>
  `${origin}/new/${isOptionsPoll(ev) && !isPartsPoll(ev) ? 'pick' : 'free'}?copy=${encodeURIComponent(ev.id)}&next=${ev.repeat}`;

/**
 * Send the reminders that are due, and return how many went. `origin` is where the site lives, for
 * polls whose settings don't say (any poll given an email since this was added does).
 */
export async function sendReminders({ store, env = {}, now = Date.now(), fetchImpl = fetch, origin = env.PUBLIC_URL } = {}) {
  if (!emailEnabled(env)) return 0;
  let sent = 0;
  for (const id of await store.dueReminders(now, now - REMINDER_WINDOW_MS)) {
    try {
      const ev = await store.getEvent(id);
      if (!ev || !REPEATS.includes(ev.repeat)) continue;
      // Not until it's over: a weekend away is still on until its last day ends.
      if (meetingEnd(ev, ev.finalStart) > now) continue;
      const settings = await store.getNotify(id);
      const site = (settings?.origin || origin || '').replace(/\/+$/, '');
      if (!settings?.email || !site || (settings.emailsSent || 0) >= MAX_ORGANIZER_EMAILS) {
        await store.markReminded(id, now, 'skipped');
        continue;
      }
      if (!(await store.markReminded(id, now, 'email'))) continue; // another run got there first
      const pollUrl = `${site}/e/${id}`;
      const unsubscribeUrl = `${pollUrl}#unsubscribe=${settings.unsubscribeToken}`;
      const msg = reminderEmail({
        title: ev.title,
        next: nextLabel(ev.repeat),
        planUrl: planNextUrl(site, ev),
        pollUrl,
        unsubscribeUrl,
      });
      await sendEmail(env, { to: settings.email, ...msg, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } }, { fetchImpl });
      const latest = (await store.getNotify(id)) || settings;
      await store.setNotify(id, { ...latest, emailsSent: (latest.emailsSent || 0) + 1 });
      await recordUsage(store, env, now, 'reminder.sent', { repeat: ev.repeat });
      sent++;
    } catch (e) {
      console.error('reminder failed', e);
    }
  }
  return sent;
}
