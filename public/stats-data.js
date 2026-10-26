// The sums behind the stats page (stats.js): daily series, weeks, weekdays and change on the
// period before. No DOM here, so it's tested in test/stats-data.test.js.

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** What the trend charts can show: an event, and the properties a count must have. */
export const METRICS = {
  polls: { label: 'Polls created', name: 'poll.created' },
  answers: { label: 'Guest answers', name: 'answer.created' },
  views: { label: 'Poll views', name: 'view', match: { page: 'poll' } },
  shares: { label: 'Shares', name: 'share' },
};

const matches = (c, { name, match = {} }) => c.name === name && Object.entries(match).every(([k, v]) => c.props[k] === v);

/** The sum of a metric's counts. */
export const total = (counts, metric) => counts.reduce((a, c) => a + (matches(c, metric) ? c.count : 0), 0);

/** Every day (YYYY-MM-DD) from `since`, `days` of them, including days with no counts. */
export function dayList(since, days) {
  const t0 = Date.parse(`${since}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => iso(t0 + i * DAY));
}

/** A metric per day: [{ day, n }] for each day in `days`. */
export function series(counts, metric, days) {
  const m = new Map(days.map((d) => [d, 0]));
  for (const c of counts) if (m.has(c.day) && matches(c, metric)) m.set(c.day, m.get(c.day) + c.count);
  return days.map((day) => ({ day, n: m.get(day) }));
}

/** Days folded into weeks of 7, counted from the first day: [{ day, end, n }]. The last may be short. */
export function weeks(daily) {
  const out = [];
  for (let i = 0; i < daily.length; i += 7) {
    const w = daily.slice(i, i + 7);
    out.push({ day: w[0].day, end: w.at(-1).day, n: w.reduce((a, d) => a + d.n, 0) });
  }
  return out;
}

/** Totals by day of the week (UTC), Monday first: [{ dow: 0..6, n }], 0 being Monday. */
export function weekdays(daily) {
  const out = Array.from({ length: 7 }, (_, dow) => ({ dow, n: 0 }));
  for (const { day, n } of daily) out[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7].n += n;
  return out;
}

/** Percent change from `before` to `now`, rounded; null when there's nothing before to compare with. */
export const change = (now, before) => (before ? Math.round((100 * (now - before)) / before) : null);
