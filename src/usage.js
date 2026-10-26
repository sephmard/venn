// Usage stats: how Venn is used, so it can get better, without tracking anyone.
//
// - Only counts. Each event adds 1 to a row for (day, event, properties). There are no user or
//   poll IDs, no IP addresses, no user agents and no times finer than the day.
// - Only known events and values (USAGE_EVENTS below). Anything else is dropped.
// - Switched on by setting STATS_TOKEN, which is also what reads them (GET /api/stats). A server
//   without it records nothing.
//
// Poll outcomes (how many polls get answers, or a final date) aren't counted separately: they are
// worked out from the polls themselves when the stats are read.

import { allDaySpan, isOptionsPoll, isPartsPoll } from '../public/core.js';
import { REPEATS } from '../public/repeat.js';

const BUCKETS = ['1', '2-3', '4-7', '8-15', '16+'];
const bucket = (n) => (n <= 1 ? '1' : n <= 3 ? '2-3' : n <= 7 ? '4-7' : n <= 15 ? '8-15' : '16+');
const YN = ['yes', 'no'];
const KINDS = ['pick', 'free'];
const DETAILS = ['times', 'allday', 'trips', 'days', 'parts', 'hours'];
const PLANS = {
  '🍝': 'dinner',
  '🍻': 'drinks',
  '☕': 'coffee',
  '📚': 'book-club',
  '🥞': 'brunch',
  '🎲': 'game-night',
  '🥾': 'hike',
  '🎉': 'party',
  '🏋️': 'gym',
  '🏃': 'run',
  '🚴': 'bike',
  '⛳': 'golf',
  '✈️': 'trip',
};

/**
 * Every event Venn counts, with the values each property may take. `client: true` events come
 * from the browser (POST /api/usage); the rest are counted by the API itself.
 */
export const USAGE_EVENTS = {
  // Server
  'poll.created': {
    kind: KINDS,
    detail: DETAILS,
    plan: [...Object.values(PLANS), 'other'],
    options: BUCKETS,
    email: YN, // the organizer gave an email for notifications
    copy: YN, // started from an existing poll
    repeat: [...REPEATS, 'no'], // the plan repeats: weekly, every 2 weeks or monthly
  },
  'poll.edited': { kind: KINDS },
  'poll.deleted': { kind: KINDS },
  'poll.finalized': { kind: KINDS },
  'answer.created': { kind: KINDS, copy: YN },
  'answer.updated': { kind: KINDS },
  'answer.deleted': { kind: KINDS },
  'notify.email': {},
  'notify.webhook': {},
  'calendar.ics': {},
  'reminder.sent': { repeat: REPEATS }, // "time to plan the next one?", to an organizer (src/reminders.js)
  'ai.used': { feature: ['draft', 'answer', 'summary', 'message'] },
  // Browser
  view: {
    client: true,
    page: ['chooser', 'pick', 'free', 'poll'],
    as: ['guest', 'organizer', 'answered'],
    from: ['guest', 'set'],
  },
  share: { client: true, how: ['sheet', 'copy', 'download'], from: ['created', 'poll', 'card'] }, // card: the "It's set" picture
};

export const usageEnabled = (env) => Boolean(env.STATS_TOKEN);

/** Only known events with known values; anything else comes back null and isn't counted. */
export function cleanUsage(name, props = {}, { client = false } = {}) {
  const spec = Object.hasOwn(USAGE_EVENTS, name) && USAGE_EVENTS[name];
  if (!spec || Boolean(spec.client) !== client || !props || typeof props !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === 'client' || !Object.hasOwn(spec, k) || !spec[k].includes(v)) return null;
    out[k] = v;
  }
  // Sorted keys, so the same properties always land in the same row.
  return { name, props: JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))) };
}

/** Which kind of poll this is: { kind: 'pick' | 'free', detail }. */
export function pollKind(ev) {
  if (isPartsPoll(ev)) return { kind: 'free', detail: 'parts' };
  if (isOptionsPoll(ev)) {
    const spans = ev.options.map((o) => allDaySpan(o.start, o.end, ev.timezone));
    if (!spans.every(Boolean)) return { kind: 'pick', detail: 'times' };
    const long = spans.some((s) => Date.parse(s.endDate) - Date.parse(s.startDate) > 86_400_000);
    return { kind: 'pick', detail: long ? 'trips' : 'allday' };
  }
  return { kind: 'free', detail: ev.slotMinutes === 1440 ? 'days' : 'hours' };
}

export const planOf = (ev) => PLANS[ev.emoji] || 'other';

/** How many options a poll offers, or days for "ask when people are free", as a bucket. */
export function sizeOf(ev) {
  const n = isOptionsPoll(ev) ? ev.options.length : new Set((ev.windows || []).map((w) => w.date).concat(ev.dates || [])).size;
  return bucket(Math.max(1, n));
}

/** Count an event (if stats are on). Never throws: a missed count must not break the request. */
export async function recordUsage(store, env, now, name, props, opts) {
  if (!usageEnabled(env)) return;
  const clean = cleanUsage(name, props, opts);
  if (!clean) return;
  try {
    await store.countUsage(new Date(now).toISOString().slice(0, 10), clean.name, clean.props);
  } catch (e) {
    console.error('usage count failed', e);
  }
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The stats for the last `days` days: the daily counts, and what happened to the polls created
 * in that time, by kind.
 */
export async function usageReport(store, { days, now }) {
  const since = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const counts = (await store.listUsage(since)).map((r) => ({ ...r, props: JSON.parse(r.props) }));
  const polls = await store.pollOutcomes(Date.parse(`${since}T00:00:00Z`));
  const byKind = {};
  for (const p of polls) {
    let ev;
    try {
      ev = JSON.parse(p.data);
    } catch {
      continue;
    }
    const { kind, detail } = pollKind(ev);
    const guests = p.answers - (ev.hostId ? 1 : 0); // the organizer's own answer isn't a guest's
    for (const key of [kind, `${kind}/${detail}`, 'all']) {
      const g = (byKind[key] ??= { polls: 0, hostAnswered: 0, answered: 0, finalized: 0, guests: [] });
      g.polls++;
      if (ev.hostId) g.hostAnswered++;
      if (guests > 0) g.answered++;
      if (p.final_start != null) g.finalized++;
      g.guests.push(guests);
    }
  }
  const outcomes = Object.fromEntries(
    Object.entries(byKind).map(([k, g]) => [
      k,
      {
        polls: g.polls,
        hostAnswered: g.hostAnswered, // the organizer answered their own poll
        answered: g.answered, // at least one guest answered (the organizer's own answer doesn't count)
        finalized: g.finalized, // the organizer picked the date
        medianGuests: median(g.guests),
        // How many guests answered each poll: { '0': 3, '1': 5, '2-3': 4, … }
        guests: g.guests.reduce((acc, n) => ((acc[n ? bucket(n) : '0'] = (acc[n ? bucket(n) : '0'] || 0) + 1), acc), {}),
      },
    ]),
  );
  return { since, days, counts, outcomes };
}
