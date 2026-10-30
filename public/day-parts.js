// Tapping a whole part of the day (or "All day") at once, on a parts-of-the-day poll. Only the
// poll page needs it.

import { IF_NEEDED, YES } from './core.js';

/** YES or IF_NEEDED when every one of `slots` has that answer, 'some' when only some are marked, else 0. */
export function groupState(availability, slots) {
  if (slots.every((s) => availability[s] === YES)) return YES;
  if (slots.every((s) => availability[s] === IF_NEEDED)) return IF_NEEDED;
  return slots.some((s) => availability[s]) ? 'some' : 0;
}

/**
 * Tapping a part of the day, or "All day", answers all of its times at once: all yes → all if
 * needed → none (unavailable, once answered), and from anything else, all yes. Changes `availability` in place.
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
