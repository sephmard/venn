// Copying a poll to plan the next one: a copy whose dates have passed is freshened, its dates
// dropped or moved on by whole weeks, keeping the wall-clock times in the poll's own time zone
// whatever daylight saving does. Pure functions on core.js, so they run in the browser and the tests.

import { addDays, longestRun, utcToZoned, zonedToUtc } from './core.js';

const DAY = 86_400_000;
const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / DAY;
const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);

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

/** Whether the shifted poll starts after `now`: its first option, or its first day (today counts). */
function upcoming(ev, now) {
  if (ev.mode === 'options') return ev.options.length > 0 && Math.min(...ev.options.map((o) => o.start)) > now;
  return ev.dates.length > 0 && ev.dates[0] >= utcToZoned(now, ev.timezone).date;
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
  // Every option moves by the same number of weeks: count up between tries, not once per option.
  while (!upcoming(next, now)) {
    weeks += 1;
    next = shiftPoll(ev, () => 7 * weeks);
  }
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
