// How long polls are kept (#213): a poll is deleted, with its answers, emails and notes, once a
// year has passed since anything happened with it. That is: it was made, someone answered or
// changed an answer, its date was picked, and its last day or option, all more than
// POLL_RETENTION_DAYS (default 365) ago. 0 keeps polls until their organizer deletes them.
// Run hourly with the deadline reminders (src/worker.js scheduled, server.js), a batch at a time.

export const POLL_RETENTION_DAYS = 365;
/** At most this many polls deleted per run, so a run stays short. */
export const PURGE_BATCH = 50;

const DAY = 86_400_000;

/** The retention from the server's settings, in days: a whole number, 0 for keep forever. */
export function retentionDays(env = {}) {
  const v = env.POLL_RETENTION_DAYS;
  if (v == null || v === '') return POLL_RETENTION_DAYS;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : POLL_RETENTION_DAYS;
}

/** Delete the polls nothing has happened with for the retention period. Returns how many. */
export async function purgeOldPolls({ store, env = {}, now = Date.now() } = {}) {
  const days = retentionDays(env);
  if (!days) return 0;
  const ids = await store.expiredEvents(now - days * DAY, PURGE_BATCH);
  for (const id of ids) await store.deleteEvent(id);
  if (ids.length) console.log('polls past retention deleted', ids.length);
  return ids.length;
}
