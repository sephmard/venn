// How a poll's times read, in the viewer's time zone. Only the poll page shows them, so the create
// pages don't download this.

import { allDaySpan, utcToZoned } from './core.js';
import { dateParts, fmtDay } from './ui.js';

/** "Sat, Nov 7, 7:00 – 9:00 PM", "Sat, Nov 7, all day" or "Fri, Nov 6 – Sun, Nov 8". */
export function fmtWhen(start, end, tz) {
  const span = allDaySpan(start, end, tz);
  if (span) {
    const last = dateParts(span.endDate);
    last.setUTCDate(last.getUTCDate() - 1);
    const first = dateParts(span.startDate);
    return +last === +first ? `${fmtDay.format(first)}, all day` : fmtDay.formatRange(first, last);
  }
  const f = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
  return f.formatRange(start, end);
}

/** Just the time part: "7:00 – 9:00 PM", "All day", or across midnight "Fri 11:00 PM – Sat 1:00 AM". */
export function fmtTimeRange(start, end, tz) {
  const span = allDaySpan(start, end, tz);
  if (span) return span.endDate === nextDate(span.startDate) ? 'All day' : fmtWhen(start, end, tz);
  const d = (t) => utcToZoned(t, tz).date;
  const f = new Intl.DateTimeFormat(undefined, {
    ...(d(start) !== d(end - 1) && { weekday: 'short' }), // no day when it ends at midnight
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
  // Not "11/13/2026, 11:00 PM – 11/14/2026, 1:00 AM", and no line starts with the dash.
  return d(start) === d(end) ? f.formatRange(start, end) : `${f.format(start)}\u00a0– ${f.format(end)}`;
}
const nextDate = (d) => {
  const t = dateParts(d);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};
