// Plans that come round again: book clubs, run clubs, game nights. These move a poll's dates on to
// the next time (next week, in two weeks or next month), keeping the wall-clock times in the poll's
// own time zone whatever daylight saving does, and freshen a copied poll whose dates have passed.
// Pure functions on core.js, so they run in the browser, the Worker, Node and the tests.

import { addDays, dayRuns, longestRun, pad, utcToZoned, weekdayOf, zonedToUtc } from './core.js';

/** How often a plan can repeat. Stored on the poll as `repeat`. */
export const REPEATS = ['weekly', 'biweekly', 'monthly'];

const DAY = 86_400_000;
/** Days in month `m` (1–12) of year `y`. */
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / DAY;
const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);

/**
 * Which of its weekday a date is in its month: 1 to 4, or 'last' for one in the month's final
 * seven days (a 5th is always the last, and a 4th that ends the month counts as the last too, so a
 * club that meets on the last Friday keeps meeting on the last Friday).
 */
export function weekdayOrdinal(date) {
  const [y, m, d] = date.split('-').map(Number);
  return d + 7 > daysIn(y, m) ? 'last' : Math.ceil(d / 7);
}

/** The `nth` (1–5, or 'last') `weekday` (0 = Sunday) of month `m` (1–12): a 5th that doesn't exist is the last. */
export function nthWeekday(y, m, weekday, nth) {
  const first = 1 + ((weekday - weekdayOf(`${y}-${pad(m)}-01`) + 7) % 7);
  const dim = daysIn(y, m);
  let day = nth === 'last' ? first + 7 * Math.floor((dim - first) / 7) : first + 7 * (nth - 1);
  if (day > dim) day -= 7;
  return `${y}-${pad(m)}-${pad(day)}`;
}

/**
 * How many days on `date` comes round `cycles` times later: 7 or 14 a time, or for monthly, the
 * same weekday of the month that many months on (the 2nd Tuesday → the 2nd Tuesday).
 */
export function cycleDays(date, repeat, cycles = 1) {
  if (repeat === 'weekly') return 7 * cycles;
  if (repeat === 'biweekly') return 14 * cycles;
  if (repeat !== 'monthly') throw new Error(`Unknown repeat: ${repeat}`);
  const [y, m] = date.split('-').map(Number);
  const t = m - 1 + cycles;
  const next = nthWeekday(y + Math.floor(t / 12), (t % 12) + 1, weekdayOf(date), weekdayOrdinal(date));
  return daysBetween(date, next);
}

/** The days a poll proposes, in its own time zone, sorted: option start days, or its dates. */
export function pollDates(ev) {
  const dates = ev.mode === 'options' ? ev.options.map((o) => utcToZoned(o.start, ev.timezone).date) : ev.dates;
  return [...new Set(dates)].sort();
}

/**
 * The poll with every day moved on by `offsetOf(day)` days (null drops the day), at the same
 * wall-clock times. Options keep their length in days; the organizer's own answer moves with them.
 */
export function shiftPoll(ev, offsetOf) {
  const tz = ev.timezone;
  const moveBy = (ms, n) => {
    const z = utcToZoned(ms, tz);
    return zonedToUtc(addDays(z.date, n), z.minutes, tz);
  };
  const move = (ms) => {
    const n = offsetOf(utcToZoned(ms, tz).date);
    return n == null ? null : moveBy(ms, n);
  };
  const out = { ...ev };
  delete out.slots;
  delete out.finalStart;
  if (ev.mode === 'options')
    out.options = ev.options.flatMap((o) => {
      const n = offsetOf(utcToZoned(o.start, tz).date);
      return n == null ? [] : [{ start: moveBy(o.start, n), end: moveBy(o.end, n) }];
    });
  else {
    const keep = (d) => offsetOf(d) != null;
    out.dates = ev.dates.filter(keep).map((d) => addDays(d, offsetOf(d)));
    if (ev.windows)
      out.windows = ev.windows.filter((w) => keep(w.date)).map((w) => ({ ...w, date: addDays(w.date, offsetOf(w.date)) }));
  }
  if (ev.participants)
    out.participants = ev.participants.map((p) => {
      if (p.id !== ev.hostId) return p;
      const availability = {};
      for (const [k, v] of Object.entries(p.availability || {})) {
        const t = move(+k);
        if (t != null) availability[t] = v;
      }
      return { ...p, availability };
    });
  return out;
}

/**
 * Days in a row move together, by the step of the first: a Friday-to-Sunday weekend stays a
 * weekend even when it runs into the next month.
 */
function runOffsets(dates, step) {
  const map = new Map();
  for (const run of dayRuns(dates)) {
    const n = step(run[0]);
    for (const d of run) map.set(d, n);
  }
  return (d) => map.get(d);
}

/** Whether the shifted poll starts after `now`: its first option, or its first day (today counts). */
function upcoming(ev, now) {
  if (ev.mode === 'options') return ev.options.length > 0 && Math.min(...ev.options.map((o) => o.start)) > now;
  return ev.dates.length > 0 && ev.dates[0] >= utcToZoned(now, ev.timezone).date;
}

/**
 * The next time round for a plan that repeats: the poll moved on one cycle, or as many as it takes
 * for it to be in the future again (a monthly book club planned late still lands on a month to come).
 */
export function nextCycle(ev, repeat, now = Date.now()) {
  if (!REPEATS.includes(repeat)) throw new Error(`Unknown repeat: ${repeat}`);
  const dates = pollDates(ev);
  if (!dates.length) return ev;
  const today = utcToZoned(now, ev.timezone).date;
  const gap = Math.max(0, daysBetween(dates[0], today));
  // Start near the right cycle, rather than stepping through every one since the poll.
  let cycles = Math.max(1, repeat === 'monthly' ? Math.floor(gap / 31) : Math.floor(gap / (repeat === 'weekly' ? 7 : 14)));
  for (let tries = 0; tries < 6; tries++, cycles++) {
    const next = shiftPoll(
      ev,
      runOffsets(dates, (d) => cycleDays(d, repeat, cycles)),
    );
    if (upcoming(next, now)) return next;
  }
  return shiftPoll(
    ev,
    runOffsets(dates, (d) => cycleDays(d, repeat, cycles)),
  );
}

/**
 * A copied poll, ready to plan again: dates that have passed are dropped; when that leaves nothing
 * to choose from (or, for a trip, not enough days in a row), everything moves on by whole weeks
 * instead, so the weekdays and times stay as they were.
 */
export function freshPoll(ev, now = Date.now()) {
  const dates = pollDates(ev);
  if (!dates.length || upcomingAll(ev, now)) return ev;
  const today = utcToZoned(now, ev.timezone).date;
  const kept =
    ev.mode === 'options'
      ? { ...ev, options: ev.options.filter((o) => o.start > now) }
      : shiftPoll(ev, (d) => (d >= today ? 0 : null));
  const span = ev.mode === 'options' ? 1 : Math.round((ev.durationMinutes || 0) / 1440) || 1;
  const enough =
    ev.mode === 'options'
      ? kept.options.length > 0
      : kept.dates.length > 0 && (ev.slotMinutes !== 1440 || longestRun(kept.dates) >= span);
  if (enough) return kept;
  let weeks = Math.max(1, Math.ceil(daysBetween(dates[0], today) / 7));
  let next = shiftPoll(ev, () => 7 * weeks);
  while (!upcoming(next, now)) next = shiftPoll(ev, () => 7 * ++weeks);
  return next;
}

/** Whether every proposed time is still to come. */
function upcomingAll(ev, now) {
  if (ev.mode === 'options') return ev.options.every((o) => o.start > now);
  return ev.dates.every((d) => d >= utcToZoned(now, ev.timezone).date);
}

/**
 * A mailto: link to last time's group: everyone who gave their email, in BCC so they don't see each
 * other's, asked to answer the new poll at `url`. '' when nobody did.
 */
export function groupMail(emails, title, url) {
  if (!emails.length) return '';
  const body = `Same again? “${title}” is coming round again. Say when works for you: ${url}\n`;
  return `mailto:?bcc=${emails.map(encodeURIComponent).join(',')}&subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** "next month's", "next week's", "the next": how the next one is named, in buttons and emails. */
export const nextLabel = (repeat) =>
  ({ weekly: 'next week’s', biweekly: 'the next', monthly: 'next month’s' })[repeat] || 'the next';
