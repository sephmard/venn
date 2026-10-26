// Which days the organizer's day strip offers. Pure, so it's tested on its own (test/day-window.test.js).

import { addDays } from './core.js';

/** Days to scroll through (YYYY-MM-DD): `ahead` days on from `today`, and at least `after` more past `day`. */
export function dayWindow(today, day, ahead = 182, after = 56) {
  const out = [];
  for (let d = today; d <= addDays(today, ahead) || d <= addDays(day, after); d = addDays(d, 1)) out.push(d);
  return out;
}
