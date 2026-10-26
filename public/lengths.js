// How long a "vote on a few dates" poll's options are, for editing or duplicating a poll and for
// the AI draft. Only the create page loads it, and only then.

import { DAY, MINUTE, allDaySpan, partOf } from './core.js';

/**
 * The create page's length for these options ({ start, end }, UTC ms) in `tz`: { length: 'days',
 * days: [each option's days] } for several days, 'allday', 'half' when each is a morning, afternoon
 * or evening, or the first option's minutes.
 */
export function optionsLength(options, tz) {
  const spans = options.map((o) => allDaySpan(o.start, o.end, tz));
  if (spans.length && spans.every(Boolean)) {
    const days = spans.map((sp) => Math.round((Date.parse(sp.endDate) - Date.parse(sp.startDate)) / DAY));
    return { length: days.some((n) => n > 1) ? 'days' : 'allday', days };
  }
  if (options.length && options.every((o) => partOf(o.start, o.end, tz))) return { length: 'half' };
  return { length: options.length ? Math.round((options[0].end - options[0].start) / MINUTE) : 120 };
}
