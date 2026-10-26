// Checking what organizers and guests send, on the server. Kept out of public/core.js so pages
// don't download code they never run.

import {
  IF_NEEDED,
  LIMITS,
  MAX_SPAN_DAYS,
  MINUTE,
  ValidationError,
  buildSlots,
  isValidTimeZone,
  YES,
  partOf,
} from '../public/core.js';

const DAY = 86_400_000;
const DAY_MINUTES = 1440;

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
  if (input.windows != null) return normalizeWindowsEvent(input, base);

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

/**
 * "When are you free" with hours that differ by day: the organizer paints windows on a calendar,
 * `windows: [{ date, start, end }]` in minutes after midnight in the poll's time zone.
 * Overlapping or touching windows on a day merge.
 */
function normalizeWindowsEvent(input, base) {
  if (!Array.isArray(input.windows) || !input.windows.length) throw new ValidationError('Pick at least one time');
  if (input.windows.length > LIMITS.windows) throw new ValidationError(`Pick at most ${LIMITS.windows} stretches of time`);
  const slotMinutes = Number(input.slotMinutes ?? 30);
  if (![15, 30, 60].includes(slotMinutes)) throw new ValidationError('Slot size must be 15, 30 or 60 minutes');
  const byDate = new Map();
  for (const w of input.windows) {
    const start = Number(w?.start);
    const end = Number(w?.end);
    if (typeof w?.date !== 'string' || !isRealDate(w.date)) throw new ValidationError('Invalid date');
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || start >= end)
      throw new ValidationError('Each time must end after it starts, within the day');
    if (start % slotMinutes || end % slotMinutes) throw new ValidationError('Times must line up with the slot size');
    if (!byDate.has(w.date)) byDate.set(w.date, []);
    byDate.get(w.date).push([start, end]);
  }
  if (byDate.size > LIMITS.dates) throw new ValidationError(`Pick at most ${LIMITS.dates} dates`);
  const windows = [];
  for (const date of [...byDate.keys()].sort()) {
    let cur = null;
    for (const [a, b] of byDate.get(date).sort((x, y) => x[0] - y[0])) {
      if (cur && a <= cur.end) cur.end = Math.max(cur.end, b);
      else windows.push((cur = { date, start: a, end: b }));
    }
  }
  const durationMinutes = Number(input.durationMinutes ?? slotMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < slotMinutes || durationMinutes % slotMinutes)
    throw new ValidationError('Meeting length must be a multiple of the slot size');
  if (!windows.some((w) => w.end - w.start >= durationMinutes))
    throw new ValidationError('Every time you picked is shorter than the meeting');
  const ev = {
    ...base,
    dates: [...byDate.keys()].sort(),
    windows,
    startMinute: Math.min(...windows.map((w) => w.start)),
    endMinute: Math.max(...windows.map((w) => w.end)),
    slotMinutes,
    durationMinutes,
  };
  if (buildSlots(ev).length > LIMITS.slots) throw new ValidationError('Too many time slots: pick fewer or shorter times');
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

// Optional emoji for the kind of plan (🍝, ✈️…). Up to a few emoji, nothing else.
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u;
function cleanEmoji(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || v.length > 16 || !EMOJI_RE.test(v) || /[0-9#*]/.test(v))
    throw new ValidationError('Invalid emoji');
  return v;
}

/** Midnight that starts the day `n` days after the one containing `ms`, in `tz`. */
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
