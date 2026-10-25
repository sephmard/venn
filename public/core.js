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

export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ---------- events ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function cleanText(v, max, field, required = false) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  v = v.trim();
  if (required && !v) throw new ValidationError(`${field} is required`);
  if (v.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return v;
}

export class ValidationError extends Error {}

/** Validate and normalise the organiser's input for a new event. */
export function normalizeEventInput(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid request');
  const title = cleanText(input.title, LIMITS.title, 'Title', true);
  const description = cleanText(input.description, LIMITS.description, 'Description');
  const organizer = cleanText(input.organizer, LIMITS.name, 'Organizer name');
  const location = cleanText(input.location, LIMITS.location, 'Location');
  const emoji = cleanEmoji(input.emoji);

  const timezone = input.timezone;
  if (!isValidTimeZone(timezone)) throw new ValidationError('Unknown time zone');

  const base = { title, description, organizer, timezone };
  if (location) base.location = location;
  if (emoji) base.emoji = emoji;
  if (input.mode === 'options') return normalizeOptionsEvent(input, base);

  if (!Array.isArray(input.dates) || input.dates.length === 0) throw new ValidationError('Pick at least one date');
  const dates = [...new Set(input.dates)].sort();
  if (dates.length > LIMITS.dates) throw new ValidationError(`Pick at most ${LIMITS.dates} dates`);
  if (!dates.every((d) => typeof d === 'string' && isRealDate(d))) throw new ValidationError('Invalid date');

  const slotMinutes = Number(input.slotMinutes);
  if (![15, 30, 60, DAY_MINUTES].includes(slotMinutes))
    throw new ValidationError('Slot size must be 15, 30 or 60 minutes, or whole days');

  const startMinute = Number(input.startMinute);
  const endMinute = Number(input.endMinute);
  if (
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    endMinute > 1440 ||
    startMinute >= endMinute
  )
    throw new ValidationError('The end time must be after the start time');
  if (startMinute % slotMinutes || endMinute % slotMinutes)
    throw new ValidationError('Start and end times must line up with the slot size');

  const durationMinutes = Number(input.durationMinutes ?? slotMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < slotMinutes || durationMinutes % slotMinutes)
    throw new ValidationError('Meeting length must be a multiple of the slot size');
  // Whole-day polls can look for several days in a row (a trip); others fit inside one day's window.
  if (slotMinutes === DAY_MINUTES) {
    if (durationMinutes > MAX_SPAN_DAYS * DAY_MINUTES)
      throw new ValidationError(`Look for at most ${MAX_SPAN_DAYS} days in a row`);
  } else if (durationMinutes > endMinute - startMinute)
    throw new ValidationError('Meeting length is longer than the daily time window');

  const ev = { ...base, dates, startMinute, endMinute, slotMinutes, durationMinutes };
  if (buildSlots(ev).length > LIMITS.slots)
    throw new ValidationError('Too many time slots: pick fewer dates, a shorter window or a larger slot size');
  return ev;
}

// "Specific times" poll: the organizer proposes exact options and people vote on each.
const MIN_TIME = Date.UTC(2000, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

function normalizeOptionsEvent(input, base) {
  if (!Array.isArray(input.options) || input.options.length === 0) throw new ValidationError('Propose at least one time');
  if (input.options.length > LIMITS.options) throw new ValidationError(`Propose at most ${LIMITS.options} times`);
  const seen = new Set();
  const options = [];
  for (const o of input.options) {
    const start = Number(o?.start),
      end = Number(o?.end);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < MIN_TIME ||
      end > MAX_TIME ||
      start % MINUTE ||
      end % MINUTE
    )
      throw new ValidationError('Invalid proposed time');
    // A few hours over the limit allows for daylight saving changes inside a multi-day option.
    if (end <= start || end - start > MAX_SPAN_DAYS * DAY + 2 * 60 * MINUTE)
      throw new ValidationError(`Each proposed time must last between 1 minute and ${MAX_SPAN_DAYS} days`);
    if (seen.has(start)) throw new ValidationError('Two proposed times start at the same moment');
    seen.add(start);
    options.push({ start, end });
  }
  options.sort((a, b) => a.start - b.start);
  const ev = { ...base, mode: 'options', options, durationMinutes: (options[0].end - options[0].start) / MINUTE };
  // "Parts of the day": people mark the mornings, afternoons and evenings they're free.
  if (input.layout === 'parts') {
    if (!options.every((o) => partOf(o.start, o.end, base.timezone)))
      throw new ValidationError('Each option must be a morning, an afternoon or an evening');
    ev.layout = 'parts';
  } else if (input.layout != null) throw new ValidationError('Unknown layout');
  return ev;
}

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

// Optional emoji for the kind of plan (🍝, ✈️…). Up to a few emoji, nothing else.
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u;
function cleanEmoji(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || v.length > 16 || !EMOJI_RE.test(v) || /[0-9#*]/.test(v))
    throw new ValidationError('Invalid emoji');
  return v;
}

/** Midnight that starts the day `n` days after the one containing `ms`, in `tz`. */
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

/** All slot start instants (UTC ms), sorted, for an event. For option polls, one per option. */
export function buildSlots(ev) {
  if (isOptionsPoll(ev)) return ev.options.map((o) => o.start);
  const set = new Set();
  for (const date of ev.dates) {
    for (let m = ev.startMinute; m < ev.endMinute; m += ev.slotMinutes) {
      const t = zonedToUtc(date, m, ev.timezone);
      // Skip wall-clock times that don't exist (spring-forward gap).
      const back = utcToZoned(t, ev.timezone);
      if (back.date === date && back.minutes === m) set.add(t);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** Validate a participant's availability map against the event's slots. */
export function normalizeAvailability(av, slots) {
  if (av == null) return {};
  if (typeof av !== 'object' || Array.isArray(av)) throw new ValidationError('Invalid availability');
  const valid = new Set(slots.map(String));
  const out = {};
  for (const [k, v] of Object.entries(av)) {
    if (!valid.has(k)) continue; // ignore stale slots rather than failing the whole save
    if (v === YES || v === IF_NEEDED) out[k] = v;
    else if (v !== 0 && v != null) throw new ValidationError('Invalid availability value');
  }
  return out;
}

export function normalizeName(name) {
  return cleanText(name, LIMITS.name, 'Name', true);
}

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

// ---------- calendar export ----------

function icsStamp(ms) {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function icsEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[,;]/g, (c) => '\\' + c);
}

const icsDate = (d) => d.replace(/-/g, '');

/** Pass `allDay` ({startDate, endDate} from allDaySpan) to make an all-day event. */
export function buildIcs({ id, title, description, start, end, url, allDay, location }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Venn//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${id}-${start}@venn`,
    `DTSTAMP:${icsStamp(Date.now())}`,
    ...(allDay
      ? [`DTSTART;VALUE=DATE:${icsDate(allDay.startDate)}`, `DTEND;VALUE=DATE:${icsDate(allDay.endDate)}`]
      : [`DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`]),
    `SUMMARY:${icsEscape(title)}`,
  ];
  const desc = [description, url].filter(Boolean).join('\n\n');
  if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function googleCalendarUrl({ title, description, start, end, allDay, location }) {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: allDay ? `${icsDate(allDay.startDate)}/${icsDate(allDay.endDate)}` : `${icsStamp(start)}/${icsStamp(end)}`,
    details: description || '',
  });
  if (location) q.set('location', location);
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function outlookCalendarUrl({ title, description, start, end, allDay, location }) {
  const q = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    body: description || '',
    startdt: allDay ? allDay.startDate : new Date(start).toISOString(),
    enddt: allDay ? allDay.endDate : new Date(end).toISOString(),
  });
  if (allDay) q.set('allday', 'true');
  if (location) q.set('location', location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q}`;
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
