// How many different people one poll may email in a day: guest emails only (answer copies,
// invitations, reminders, the date's "It's happening" and a vote's decision). Every one of those
// addresses was typed by someone (an answer's email isn't confirmed), so without a cap one person
// could answer their own poll hundreds of times with other people's addresses and have Venn email
// them all, several times over. A real group is never near it: the same people getting a copy, the
// date and a reminder count once each. Emails to the organizer don't count.
//
// Each recipient is kept only as a hash of the poll id and the address, for the day, and the rows
// are cleared after two days (store.claimRecipient). With the EMAIL_HASH_SECRET secret set, the
// hash is an HMAC keyed with it, so someone holding a copy of the database can't check guessed
// addresses against it; without it, a plain SHA-256. POLL_RECIPIENTS_PER_DAY changes the cap; 0
// turns it off.
//
// The whole server also has a daily ceiling, EMAIL_DAILY_LIMIT (default 1,000 a day, 0 for none),
// so nothing can run up the email plan or the sending address's reputation in one day. Guest
// emails stop at 80% of it, which leaves the rest for sign-in links, password resets and the
// organizer's own emails.

export const POLL_RECIPIENTS_PER_DAY = 100;

/** The cap from the server's settings: a whole number, 0 for none. */
export function recipientCap(env = {}) {
  const v = env.POLL_RECIPIENTS_PER_DAY;
  if (v == null || v === '') return POLL_RECIPIENTS_PER_DAY;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : POLL_RECIPIENTS_PER_DAY;
}

export const EMAIL_DAILY_LIMIT = 1000;
/** The share of the daily ceiling guest emails may use. */
export const GUEST_SHARE = 0.8;

/** The server's daily ceiling from its settings: a whole number, 0 for none. */
export function dailyLimit(env = {}) {
  const v = env.EMAIL_DAILY_LIMIT;
  if (v == null || v === '') return EMAIL_DAILY_LIMIT;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : EMAIL_DAILY_LIMIT;
}

const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * Whether the server may send one more email today (UTC), counting it if so. `guest`: an email to
 * someone other than the organizer or the account holder, which stops at GUEST_SHARE of the
 * ceiling. Past it, false, with a log line that never names the address.
 */
export async function withinDailyLimit(store, env, { guest = false } = {}, now = Date.now()) {
  const limit = dailyLimit(env);
  if (!limit) return true;
  const cap = guest ? Math.max(1, Math.floor(limit * GUEST_SHARE)) : limit;
  // A count that can't be kept (the database, briefly) doesn't stop a sign-in link: it sends.
  const ok = await Promise.resolve()
    .then(() => store.countEmail(utcDay(now), cap))
    .catch((e) => (console.error('daily email count failed', e?.message), true));
  if (!ok) console.warn(guest ? 'daily email ceiling reached for guest emails' : 'daily email ceiling reached');
  return ok;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The recipient's hash: an HMAC with EMAIL_HASH_SECRET when it's set, else SHA-256. */
export async function recipientHash(eventId, email, env = {}) {
  const text = new TextEncoder().encode(`${eventId}\n${String(email).trim().toLowerCase()}`);
  const secret = env.EMAIL_HASH_SECRET;
  if (!secret) return hex(await crypto.subtle.digest('SHA-256', text));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return hex(await crypto.subtle.sign('HMAC', key, text));
}

/**
 * Whether poll `eventId` may email guest `to` today (UTC), counting them if so: true for someone it
 * has already emailed today, or while it has emailed fewer than the cap, and while the server is
 * under its daily ceiling for guest emails. Otherwise false, with one log line that names the poll
 * and never the address.
 */
export async function mayEmail(store, env, eventId, to, now = Date.now()) {
  const cap = recipientCap(env);
  if (cap) {
    const ok = await store.claimRecipient(eventId, utcDay(now), await recipientHash(eventId, to, env), cap);
    if (!ok) {
      console.warn('poll recipient cap reached', eventId);
      return false;
    }
  }
  return withinDailyLimit(store, env, { guest: true }, now);
}
