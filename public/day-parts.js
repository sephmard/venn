// Answering an hours poll by parts of the day: which part a time falls in, whether an answer can be
// shown that way, and tapping a whole part (or "All day") at once. Only the poll page needs it.

import { IF_NEEDED, YES, utcToZoned } from './core.js';

/** Which part of the day a time of an hours poll counts in, by its minutes after midnight. */
export const partKey = (m) => (m < 720 ? 'morning' : m < 1020 ? 'afternoon' : 'evening');

/**
 * Whether an answer to an hours poll can be shown as parts of the day, with nothing lost: every
 * time in each day's morning, afternoon and evening (in `tz`) has the same answer.
 */
export function fitsParts(slots, availability, tz) {
  const seen = new Map();
  for (const s of slots) {
    const z = utcToZoned(s, tz);
    const k = `${z.date}|${partKey(z.minutes)}`;
    const v = availability[s] || 0;
    if (seen.has(k) && seen.get(k) !== v) return false;
    seen.set(k, v);
  }
  return true;
}

/** YES or IF_NEEDED when every one of `slots` has that answer, 'some' when only some are marked, else 0. */
export function groupState(availability, slots) {
  if (slots.every((s) => availability[s] === YES)) return YES;
  if (slots.every((s) => availability[s] === IF_NEEDED)) return IF_NEEDED;
  return slots.some((s) => availability[s]) ? 'some' : 0;
}

/**
 * Tapping a part of the day, or "All day", answers all of its times at once: all yes → all if
 * needed → cleared, and from anything else, all yes. Changes `availability` in place.
 */
export function cycleGroup(availability, slots) {
  const v = groupState(availability, slots);
  for (const s of slots) {
    if (v === YES) availability[s] = IF_NEEDED;
    else if (v === IF_NEEDED) delete availability[s];
    else availability[s] = YES;
  }
  return availability;
}
