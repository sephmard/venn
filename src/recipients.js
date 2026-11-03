// How many different people one poll may email in a day: guest emails only (answer copies,
// invitations, reminders, the date's "It's happening" and a vote's decision). Every one of those
// addresses was typed by someone (an answer's email isn't confirmed), so without a cap one person
// could answer their own poll hundreds of times with other people's addresses and have Venn email
// them all, several times over. A real group is never near it: the same people getting a copy, the
// date and a reminder count once each. Emails to the organizer don't count.
//
// Each recipient is kept only as a SHA-256 hash of the poll id and the address, for the day, and
// the rows are cleared after two days (store.claimRecipient). POLL_RECIPIENTS_PER_DAY changes the
// cap; 0 turns it off.

export const POLL_RECIPIENTS_PER_DAY = 100;

/** The cap from the server's settings: a whole number, 0 for none. */
export function recipientCap(env = {}) {
  const v = env.POLL_RECIPIENTS_PER_DAY;
  if (v == null || v === '') return POLL_RECIPIENTS_PER_DAY;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : POLL_RECIPIENTS_PER_DAY;
}

async function recipientHash(eventId, email) {
  const text = `${eventId}\n${String(email).trim().toLowerCase()}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether poll `eventId` may email `to` today (UTC), counting them if so: true for someone it has
 * already emailed today, or while it has emailed fewer than the cap. Past the cap, false, with one
 * log line that names the poll and never the address.
 */
export async function mayEmail(store, env, eventId, to, now = Date.now()) {
  const cap = recipientCap(env);
  if (!cap) return true;
  const day = new Date(now).toISOString().slice(0, 10);
  const ok = await store.claimRecipient(eventId, day, await recipientHash(eventId, to), cap);
  if (!ok) console.warn('poll recipient cap reached', eventId);
  return ok;
}
