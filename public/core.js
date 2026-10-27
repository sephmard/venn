// Shared logic used by the browser, the Cloudflare Worker and the Node server.
// No dependencies: time zones are handled with Intl.

export const YES = 2;
export const IF_NEEDED = 1;

export const LIMITS = {
  title: 120,
  description: 1000,
  name: 80,
  location: 200,
  dates: 62,
  slots: 2500,
  participants: 300,
  options: 100,
  windows: 300,
};

const MINUTE = 60_000;
const DAY = 86_400_000;
const DAY_MINUTES = 1440;
// Longest trip or multi-day option, in days.
export const MAX_SPAN_DAYS = 14;

/** Parts of the day, in minutes after midnight, for quick picks and "parts of the day" polls. */
export const DAY_PARTS = [
  { key: 'morning', label: 'Morning', start: 540, end: 720 },
  { key: 'afternoon', label: 'Afternoon', start: 720, end: 1020 },
  { key: 'evening', label: 'Evening', start: 1080, end: 1320 },
];

// ---------- time zones ----------

const formatterCache = new Map();
function partsFormatter(tz) {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

function zonedParts(ms, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    year: +out.year,
    month: +out.month,
    day: +out.day,
    hour: +out.hour,
    minute: +out.minute,
    second: +out.second,
    weekday: out.weekday,
  };
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds. */
export function tzOffsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant for wall-clock `dateStr` (YYYY-MM-DD) + `minutes` after midnight in `tz`. */
export function zonedToUtc(dateStr, minutes, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const off1 = tzOffsetMs(guess, tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}

/** Wall-clock view of a UTC instant in `tz`. */
export function utcToZoned(ms, tz) {
  const p = zonedParts(ms, tz);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    minutes: p.hour * 60 + p.minute,
    weekday: p.weekday,
  };
}

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The most days in a row among `dates` (YYYY-MM-DD, any order), e.g. 1 for Tue and Thu. */
export function longestRun(dates) {
  const set = new Set(dates);
  let best = 0;
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue; // count each run once, from its first day
    let n = 1;
    while (set.has(addDays(d, n))) n++;
    best = Math.max(best, n);
  }
  return best;
}

/** `dates` (YYYY-MM-DD, any order) as runs of days in a row: [['…-06', '…-07', '…-08'], ['…-11']]. */
export function dayRuns(dates) {
  const runs = [];
  for (const d of [...new Set(dates)].sort()) {
    const last = runs.at(-1);
    if (last && addDays(last.at(-1), 1) === d) last.push(d);
    else runs.push([d]);
  }
  return runs;
}

/**
 * The slot (a UTC instant) that a "YYYY-MM-DD|minutes" key (or a whole day, "YYYY-MM-DD") starts
 * at in `tz`, or null for a wall-clock time that doesn't exist there, like buildSlots skips.
 */
export function keySlot(key, tz) {
  const [date, m] = key.split('|');
  const minutes = +m || 0;
  const t = zonedToUtc(date, minutes, tz);
  const back = utcToZoned(t, tz);
  return back.date === date && back.minutes === minutes ? t : null;
}

/** The organizer's answer from what they picked (`keys`): yes, or if needed for the keys in `maybe`. */
export function hostAnswer(keys, maybe, tz) {
  const out = {};
  for (const k of keys) {
    const t = keySlot(k, tz);
    if (t != null) out[t] = maybe.has(k) ? IF_NEEDED : YES;
  }
  return out;
}

export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ---------- events ----------

export class ValidationError extends Error {}

/** The part of the day (from DAY_PARTS) that `start`–`end` covers exactly in `tz`, or null. */
export function partOf(start, end, tz) {
  const a = utcToZoned(start, tz),
    b = utcToZoned(end, tz);
  if (a.date !== b.date) return null;
  return DAY_PARTS.find((p) => p.start === a.minutes && p.end === b.minutes) || null;
}

export const isPartsPoll = (ev) => isOptionsPoll(ev) && ev.layout === 'parts';

export const isOptionsPoll = (ev) => ev.mode === 'options';
/** Polls where people mark whole days rather than times of day. */
export const isDaysPoll = (ev) => !isOptionsPoll(ev) && ev.slotMinutes === DAY_MINUTES;

function midnightAfter(ms, n, tz) {
  return zonedToUtc(addDays(utcToZoned(ms, tz).date, n), 0, tz);
}

/** End of the slot that starts at `s`. Whole-day slots end at the next midnight, whatever DST does. */
export function slotEnd(ev, s) {
  return isDaysPoll(ev) ? midnightAfter(s, 1, ev.timezone) : s + ev.slotMinutes * MINUTE;
}

/** End instant of the meeting that starts at `start`. */
export function meetingEnd(ev, start) {
  if (isOptionsPoll(ev)) return ev.options.find((o) => o.start === start)?.end ?? start + ev.durationMinutes * MINUTE;
  if (isDaysPoll(ev)) return midnightAfter(start, ev.durationMinutes / DAY_MINUTES, ev.timezone);
  return start + ev.durationMinutes * MINUTE;
}

/**
 * If `start`–`end` covers whole days in `tz` (midnight to midnight), the first day and the
 * day after the last, as YYYY-MM-DD. Calendars show these as all-day events.
 */
export function allDaySpan(start, end, tz) {
  const a = utcToZoned(start, tz),
    b = utcToZoned(end, tz);
  if (a.minutes || b.minutes || b.date <= a.date) return null;
  return { startDate: a.date, endDate: b.date };
}

/**
 * The create page's length chip for a length: 1 to 4 hours (the lengths templates use), all day and
 * several days have their own; half days and other minutes are under "Custom".
 */
export const lengthChip = (length) => ([60, 120, 180, 240, 'allday', 'days'].includes(length) ? String(length) : 'custom');

// The email rule the server uses, so the create page catches the same mistakes before sending.
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
export const isEmail = (v) => v.length <= 254 && EMAIL_RE.test(v);

/** All slot start instants (UTC ms), sorted, for an event. For option polls, one per option. */
export function buildSlots(ev) {
  if (isOptionsPoll(ev)) return ev.options.map((o) => o.start);
  const set = new Set();
  // Hours that differ by day, or the same hours every day.
  const ranges = ev.windows || ev.dates.map((date) => ({ date, start: ev.startMinute, end: ev.endMinute }));
  for (const { date, start, end } of ranges) {
    for (let m = start; m < end; m += ev.slotMinutes) {
      const t = zonedToUtc(date, m, ev.timezone);
      // Skip wall-clock times that don't exist (spring-forward gap).
      const back = utcToZoned(t, ev.timezone);
      if (back.date === date && back.minutes === m) set.add(t);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** Validate a participant's availability map against the event's slots. */
/**
 * Rank every possible meeting start by how many people can make the whole meeting.
 * Returns [{start, end, yes:[names], ifNeeded:[names], no:[names]}], best first.
 */
export function rankTimes(ev, slots, participants, limit = 5) {
  if (isOptionsPoll(ev)) return rankOptions(ev, participants, limit);
  const slotMs = ev.slotMinutes * MINUTE;
  const k = Math.max(1, Math.round(ev.durationMinutes / ev.slotMinutes));
  const days = isDaysPoll(ev);
  const results = [];
  for (let i = 0; i + k <= slots.length; i++) {
    const start = slots[i];
    // The window must be contiguous: back-to-back slots, or consecutive days for whole-day polls.
    const last = slots[i + k - 1];
    if (days ? last !== midnightAfter(start, k - 1, ev.timezone) : last !== start + (k - 1) * slotMs) continue;
    const yes = [],
      ifNeeded = [],
      no = [];
    for (const p of participants) {
      let worst = YES;
      for (let j = 0; j < k && worst > 0; j++) worst = Math.min(worst, p.availability[slots[i + j]] || 0);
      (worst === YES ? yes : worst === IF_NEEDED ? ifNeeded : no).push(p.name);
    }
    if (yes.length + ifNeeded.length === 0) continue;
    results.push({ start, end: days ? midnightAfter(start, k, ev.timezone) : start + k * slotMs, yes, ifNeeded, no });
  }
  return sortRanked(results).slice(0, limit);
}

function rankOptions(ev, participants, limit) {
  const results = [];
  for (const { start, end } of ev.options) {
    const yes = [],
      ifNeeded = [],
      no = [];
    for (const p of participants) {
      const v = p.availability[start];
      (v === YES ? yes : v === IF_NEEDED ? ifNeeded : no).push(p.name);
    }
    if (yes.length + ifNeeded.length === 0) continue;
    results.push({ start, end, yes, ifNeeded, no });
  }
  return sortRanked(results).slice(0, limit);
}

function sortRanked(results) {
  return results.sort(
    (a, b) =>
      b.yes.length + b.ifNeeded.length - (a.yes.length + a.ifNeeded.length) || b.yes.length - a.yes.length || a.start - b.start,
  );
}

// ---------- calendar import (.ics) ----------

const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unfold(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function parseProp(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(';');
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

// Returns {date, minutes, tz} wall clock (tz null = UTC), or {allDay:true}.
function parseIcsDate(prop, fallbackTz) {
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return { date, minutes: 0, tz: fallbackTz, allDay: true };
  const minutes = +m[4] * 60 + +m[5];
  let tz = m[7] ? 'UTC' : prop.params.TZID || fallbackTz;
  if (!isValidTimeZone(tz)) tz = fallbackTz;
  return { date, minutes, tz, allDay: false };
}

function wallToMs(w) {
  return zonedToUtc(w.date, w.minutes, w.tz);
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * 1440 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0)) * MINUTE + (+m[6] || 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function parseRrule(v) {
  const r = {};
  for (const part of v.split(';')) {
    const [k, val] = part.split('=');
    if (k && val) r[k.toUpperCase()] = val;
  }
  return r;
}

/**
 * Parse busy intervals from an iCalendar file, within [rangeStart, rangeEnd).
 * Skips all-day events, cancelled events and events marked as free (TRANSP:TRANSPARENT).
 * Supports DAILY and WEEKLY recurrence (INTERVAL, COUNT, UNTIL, BYDAY, EXDATE, RECURRENCE-ID).
 */
export function parseIcsBusy(text, rangeStart, rangeEnd, fallbackTz = 'UTC') {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') cur = { exdates: new Set() };
    else if (line === 'END:VEVENT') {
      if (cur) events.push(cur);
      cur = null;
    } else if (cur) {
      const p = parseProp(line);
      if (!p) continue;
      if (p.name === 'DTSTART') cur.start = parseIcsDate(p, fallbackTz);
      else if (p.name === 'DTEND') cur.end = parseIcsDate(p, fallbackTz);
      else if (p.name === 'DURATION') cur.duration = parseDuration(p.value);
      else if (p.name === 'RRULE') cur.rrule = parseRrule(p.value);
      else if (p.name === 'UID') cur.uid = p.value;
      else if (p.name === 'RECURRENCE-ID') cur.recurrenceId = parseIcsDate(p, fallbackTz);
      else if (p.name === 'STATUS') cur.status = p.value.toUpperCase();
      else if (p.name === 'TRANSP') cur.transp = p.value.toUpperCase();
      else if (p.name === 'EXDATE') {
        for (const v of p.value.split(',')) {
          const d = parseIcsDate({ ...p, value: v }, fallbackTz);
          if (d) cur.exdates.add(d.allDay ? d.date : wallToMs(d));
        }
      }
    }
  }

  // Instances moved or cancelled via RECURRENCE-ID replace the original occurrence.
  const overridden = new Map();
  for (const e of events) {
    if (e.uid && e.recurrenceId && !e.recurrenceId.allDay) {
      if (!overridden.has(e.uid)) overridden.set(e.uid, new Set());
      overridden.get(e.uid).add(wallToMs(e.recurrenceId));
    }
  }

  const busy = [];
  for (const e of events) {
    if (!e.start || e.start.allDay) continue;
    const startMs = wallToMs(e.start);
    let dur = e.end && !e.end.allDay ? wallToMs(e.end) - startMs : (e.duration ?? 0);
    if (!(dur > 0)) continue;
    const free = e.status === 'CANCELLED' || e.transp === 'TRANSPARENT';
    const skip = overridden.get(e.uid);
    const occurrences = e.rrule && !e.recurrenceId ? expandRrule(e.start, e.rrule, rangeEnd) : [startMs];
    for (const s of occurrences) {
      if (e.exdates.has(s) || (skip && e.rrule && skip.has(s))) continue;
      if (free) continue;
      if (s < rangeEnd && s + dur > rangeStart) busy.push({ start: s, end: s + dur });
    }
  }
  return busy.sort((a, b) => a.start - b.start);
}

function expandRrule(start, r, rangeEnd) {
  const freq = r.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return [wallToMs(start)];
  const interval = Math.max(1, parseInt(r.INTERVAL, 10) || 1);
  const count = r.COUNT ? parseInt(r.COUNT, 10) : Infinity;
  let until = Infinity;
  if (r.UNTIL) {
    const u = parseIcsDate({ value: r.UNTIL, params: {} }, start.tz);
    if (u) until = u.allDay ? zonedToUtc(addDays(u.date, 1), 0, start.tz) - 1 : wallToMs(u);
  }
  const days =
    freq === 'WEEKLY' && r.BYDAY
      ? r.BYDAY.split(',')
          .map((d) => BYDAY[d.slice(-2)])
          .filter((d) => d != null)
          .sort()
      : [weekdayOf(start.date)];

  const out = [];
  let n = 0;
  const startMs = wallToMs(start);
  const startWeekday = weekdayOf(start.date);
  for (let step = 0; step < 5000 && n < count; step++) {
    const candidates = [];
    if (freq === 'DAILY') candidates.push(addDays(start.date, step * interval));
    else {
      const weekStart = addDays(start.date, step * interval * 7 - startWeekday);
      for (const d of days) candidates.push(addDays(weekStart, d));
    }
    let done = false;
    for (const date of candidates) {
      const t = zonedToUtc(date, start.minutes, start.tz);
      if (t < startMs) continue;
      if (t > until || t >= rangeEnd || n >= count) {
        done = true;
        break;
      }
      out.push(t);
      n++;
    }
    if (done) break;
  }
  return out;
}

/** Which windows of an event (grid slots or proposed options) as [{start, end}]. */
export function eventWindows(ev) {
  if (isOptionsPoll(ev)) return ev.options;
  return buildSlots(ev).map((s) => ({ start: s, end: slotEnd(ev, s) }));
}

/**
 * Turn busy intervals into an availability map: free windows = YES, windows that only
 * clash with tentative events = IF_NEEDED, busy ones omitted (no).
 */
export function availabilityFromBusy(windows, busy) {
  const out = {};
  for (const w of windows) {
    const clashes = busy.filter((b) => b.start < w.end && b.end > w.start);
    if (!clashes.length) out[w.start] = YES;
    else if (clashes.every((b) => b.tentative)) out[w.start] = IF_NEEDED;
  }
  return out;
}

export { MINUTE, DAY };
