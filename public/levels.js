// The create page's levels, whole days, parts of the day and hours, and how picks carry between
// them. No DOM here: paint.js passes these on, and test/levels.test.js covers them.

import { DAY_PARTS, addDays } from './core.js';
import { esc, shortRange } from './ui.js';

const STEP = 30;

// ---------- the levels: whole days, parts of the day and hours ----------
// `st` is what the create page has picked at each level, { days, parts, hours } (Sets of
// "YYYY-MM-DD", "YYYY-MM-DD|<part start>" and "YYYY-MM-DD|minutes"), with `maybe` (the same, for
// what's only if needed for the organizer) and `defaultParts` (the parts a new day gets).

// A whole day in hours: every hour the calendar shows, 7 AM to midnight.
export const ALL_DAY = [420, 1440];
const LEVELS = ['days', 'parts', 'hours'];
/** Hours that cover the whole day read as the day: "All day", not "9 AM – 10 PM". */
export const hoursLabel = (a, b) => (a <= ALL_DAY[0] && b >= ALL_DAY[1] ? 'All day' : shortRange(a, b));
const slots = (from, to) => Array.from({ length: (to - from) / STEP }, (_, i) => from + i * STEP);
export const datesOf = (keys) => [...new Set([...keys].map((k) => k.split('|')[0]))].sort();
// The part of the day a painted half hour belongs to (the gaps between parts go to the nearest).
const partOfSlot = (m) => DAY_PARTS[m < 720 ? 0 : m < 1050 ? 1 : 2];
const partAt = (m) => DAY_PARTS.find((p) => p.start === +m);
const partsIn = (from, to) => DAY_PARTS.filter((p) => p.start >= from && p.end <= to).map((p) => p.start);
const reset = (set, keys) => {
  set.clear();
  for (const k of keys) set.add(k);
};

/** Painted "date|minutes" keys as windows: [{ date, start, end }], 30-minute steps merged. */
export function toWindows(painted) {
  const byDate = new Map();
  for (const k of painted) {
    const [d, m] = k.split('|');
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(+m);
  }
  const out = [];
  for (const d of [...byDate.keys()].sort()) {
    let cur = null;
    for (const m of byDate.get(d).sort((a, b) => a - b)) {
      if (cur && cur.end === m) cur.end = m + STEP;
      else out.push((cur = { date: d, start: m, end: m + STEP }));
    }
  }
  return out;
}

/**
 * Carry what's picked from one level to another. Zooming out keeps exactly the days (or parts)
 * that have something; zooming in keeps what's there and fills in days that have nothing yet.
 * Then the same for what's if needed: a day (or part) is if needed when everything picked in it
 * is; zooming in, its times follow it when it was switched.
 */
export function zoom(st, from, to) {
  if (!from || from === to) return;
  const { days, parts, hours } = st;
  if (to === 'days') reset(days, datesOf(from === 'parts' ? parts : hours));
  else if (from === 'hours')
    reset(
      parts,
      [...hours].map((k) => `${k.split('|')[0]}|${partOfSlot(+k.split('|')[1]).start}`),
    );
  else if (to === 'parts') {
    // From whole days: each day keeps its parts, and a new day gets the usual ones.
    const had = new Set(datesOf(parts));
    for (const k of [...parts]) if (!days.has(k.split('|')[0])) parts.delete(k);
    for (const d of days) {
      if (had.has(d)) continue;
      // A day with times of its own lights the parts they're in; another gets the usual ones.
      const own = ownHours(st, d);
      if (own) for (const w of own) for (const m of slots(w.start, w.end)) parts.add(`${d}|${partOfSlot(m).start}`);
      else for (const p of DAY_PARTS) if (st.defaultParts.has(p.key)) parts.add(`${d}|${p.start}`);
    }
  } else {
    // Into hours: keep painted times in the parts (or days) still picked, and paint the rest whole.
    const keep = from === 'parts' ? (d, m) => parts.has(`${d}|${partOfSlot(m).start}`) : (d) => days.has(d);
    for (const k of [...hours]) {
      const [d, m] = k.split('|');
      if (!keep(d, +m)) hours.delete(k);
    }
    // A day with every part picked is the whole day, with no gaps between the parts.
    const whole = (d) => DAY_PARTS.every((p) => parts.has(`${d}|${p.start}`));
    const want =
      from === 'parts'
        ? [
            ...datesOf(parts)
              .filter(whole)
              .map((d) => [d, ...ALL_DAY]),
            ...[...parts]
              .filter((k) => !whole(k.split('|')[0]))
              .map((k) => [k.split('|')[0], partAt(k.split('|')[1]).start, partAt(k.split('|')[1]).end]),
          ]
        : [...days]
            .filter((d) => ![...hours].some((k) => k.startsWith(`${d}|`)))
            .flatMap((d) => {
              // From days, a day with parts picked keeps them (if needed too); another is the whole day.
              const own = [...parts].filter((k) => k.startsWith(`${d}|`));
              if (!own.length || whole(d)) return [[d, ...ALL_DAY]];
              return own.map((k) => [d, partAt(k.split('|')[1]).start, partAt(k.split('|')[1]).end, st.maybe.parts.has(k)]);
            });
    for (const [d, a, b, m] of want) {
      const ks = slots(a, b).map((x) => `${d}|${x}`);
      if (!ks.some((k) => hours.has(k))) for (const k of ks) (hours.add(k), m && st.maybe.hours.add(k));
    }
  }
  // If needed, from the coarser level to the finer one or back.
  const [coarse, fine] = LEVELS.indexOf(to) < LEVELS.indexOf(from) ? [to, from] : [from, to];
  const up = (k) => {
    const [d, m] = k.split('|');
    return coarse === 'parts' ? `${d}|${partOfSlot(+m).start}` : d;
  };
  const [fm, cm] = [st.maybe[fine], st.maybe[coarse]];
  const all = new Map(); // coarse key → whether everything picked in it is if needed
  for (const k of st[fine]) all.set(up(k), (all.get(up(k)) ?? true) && fm.has(k));
  if (to === coarse)
    reset(
      cm,
      [...all].filter(([, m]) => m).map(([c]) => c),
    );
  else for (const k of st[fine]) if (all.get(up(k)) !== cm.has(up(k))) cm.has(up(k)) ? fm.add(k) : fm.delete(k);
  for (const k of [...st.maybe[to]]) if (!st[to].has(k)) st.maybe[to].delete(k);
}

/** What guests will mark at parts of the day or hours: [{ date, start, end, maybe }], in order. */
export function windowsAt(st, level) {
  const ws =
    level === 'parts'
      ? [...st.parts].map((k) => {
          const [date, m] = k.split('|');
          return { date, start: partAt(m).start, end: partAt(m).end, maybe: st.maybe.parts.has(k) };
        })
      : [
          ...toWindows([...st.hours].filter((k) => !st.maybe.hours.has(k))),
          ...toWindows(st.maybe.hours).map((w) => ({ ...w, maybe: true })),
        ];
  return ws.sort(byTime);
}
const byTime = (a, b) => a.date.localeCompare(b.date) || a.start - b.start;

/** A day's own times: what's drawn on it in hours, unless that's just the whole day or parts of it. */
export function ownHours(st, d) {
  const ws = windowsAt(st, 'hours').filter((w) => w.date === d);
  const plain = (w) => (w.start === ALL_DAY[0] && w.end === ALL_DAY[1]) || partAt(w.start)?.end === w.end;
  return ws.length && !ws.every(plain) ? ws : null;
}

/** Picked days' windows at parts of the day, a day with times of its own keeping them. */
export const partsWindows = (st) => {
  const ws = windowsAt(st, 'parts');
  const own = new Map(datesOf(ws.map((w) => w.date)).map((d) => [d, ownHours(st, d)]));
  return ws
    .filter((w) => !own.get(w.date))
    .concat(...[...own.values()].filter(Boolean))
    .sort(byTime);
};

/**
 * A tap on parts of the day, on a day with times of its own, acts on those times: a part taken away
 * takes its times, a part added adds all of it, and if needed carries over.
 */
export function syncHours(st, was, wasMaybe) {
  const { parts, hours, maybe } = st;
  const inPart = (d, p) => [...hours].filter((k) => k.startsWith(`${d}|`) && partOfSlot(+k.split('|')[1]).start === +p);
  const mark = (k, on) => (on ? maybe.hours.add(k) : maybe.hours.delete(k));
  for (const k of was) {
    const [d, p] = k.split('|');
    if (!parts.has(k) && ownHours(st, d)) for (const h of inPart(d, p)) (hours.delete(h), maybe.hours.delete(h));
  }
  for (const k of parts) {
    const [d, p] = k.split('|');
    if (!ownHours(st, d)) continue;
    if (!was.has(k))
      for (const m of slots(partAt(p).start, partAt(p).end)) (hours.add(`${d}|${m}`), mark(`${d}|${m}`, maybe.parts.has(k)));
    else if (maybe.parts.has(k) !== wasMaybe.has(k)) for (const h of inPart(d, p)) mark(h, maybe.parts.has(k));
  }
}

/** Picked days with times of their own (less than the whole day): drawn in hours, or at `level`. */
export function timedDays(st, level) {
  const at = windowsAt(st, level);
  const whole = (ws) =>
    (ws.length === 1 && hoursLabel(ws[0].start, ws[0].end) === 'All day') ||
    (level === 'parts' && ws.length === DAY_PARTS.length);
  const out = new Map();
  for (const d of st.days) {
    const ws = ownHours(st, d) || at.filter((w) => w.date === d);
    if (ws.length && !whole(ws)) out.set(d, ws);
  }
  return out;
}

/** What a chip in the list ("dates|from|to") stands for: a day's own times are hours on every
 * level; on days, a whole day is the day ('days'); otherwise times at the last time level. */
export function chipLevel(st, level, timeLevel, v) {
  const [ds, a, b] = v.split('|');
  if (level !== 'hours' && ownHours(st, ds.split(',')[0])) return 'hours';
  if (level !== 'days') return level;
  return +a === ALL_DAY[0] && +b === ALL_DAY[1] ? 'days' : timeLevel || 'hours';
}

/** After times are removed from the list: a day (on days) or a part (on parts) left without any goes. */
export function tidy(st, level, lv, dates) {
  for (const d of dates) {
    if (level === 'days' && ![...st[lv]].some((k) => k.startsWith(`${d}|`))) st.days.delete(d);
    if (level === 'parts' && lv === 'hours')
      for (const p of DAY_PARTS)
        if (![...st.hours].some((k) => k.startsWith(`${d}|`) && partOfSlot(+k.split('|')[1]) === p))
          st.parts.delete(`${d}|${p.start}`);
  }
}

/** Days no longer picked lose their times: picked again, they start afresh. */
export function dropDays(st, was) {
  for (const d of was)
    if (!st.days.has(d))
      for (const set of [st.parts, st.hours]) for (const k of [...set]) if (k.startsWith(`${d}|`)) set.delete(k);
}

/** The keys a window in the list ("dates|from|to") stands for. */
export function windowKeys(level, value) {
  const [ds, from, to] = value.split('|');
  const mins = level === 'parts' ? partsIn(+from, +to) : slots(+from, +to);
  return ds.split(',').flatMap((d) => mins.map((m) => `${d}|${m}`));
}
/** What a window's × asks before removing it from several days. */
export function windowWhat(level, value) {
  const [ds, from, to] = value.split('|');
  const n = ds.split(',').length;
  if (level !== 'parts') return `${hoursLabel(+from, +to)} on these ${n} days`;
  return partAt(from)?.end === +to ? `these ${n} ${partAt(from).label.toLowerCase()}s` : `these ${n} days`;
}

/** The windows as a list: days in a row with the same times together, each time a chip. */
export function windowList(windows, chip, dayRange) {
  // The same at every level: "All day", "Morning 9 AM – 12 PM", or the times.
  const label = (a, b) => (partAt(a)?.end === b ? `${partAt(a).label} ${shortRange(a, b)}` : hoursLabel(a, b));
  const groups = [];
  for (const d of datesOf(windows.map((w) => w.date))) {
    let ranges = windows.filter((w) => w.date === d).map((w) => [w.start, w.end, !!w.maybe]);
    // Every part of the day, all the same, is the whole day: one chip.
    if (
      ranges.length === DAY_PARTS.length &&
      ranges.every((r, i) => r[0] === DAY_PARTS[i].start && r[1] === DAY_PARTS[i].end && r[2] === ranges[0][2])
    )
      ranges = [[ALL_DAY[0], ALL_DAY[1], ranges[0][2]]];
    const last = groups.at(-1);
    if (last && addDays(last.dates.at(-1), 1) === d && JSON.stringify(last.ranges) === JSON.stringify(ranges)) last.dates.push(d);
    else groups.push({ dates: [d], ranges });
  }
  return `<ul class="od-list">${groups
    .map((g) => {
      const ds = dayRange(g.dates);
      return `<li class="od-row"><span class="od-date">${esc(ds)}</span><span class="chips">${g.ranges
        .map(([a, b, m]) => {
          const at = `="${g.dates.join(',')}|${a}|${b}"`;
          return chip(`data-flip-window${at}`, `data-rm-window${at}`, label(a, b), `${ds}, ${label(a, b)}`, m);
        })
        .join('')}</span></li>`;
    })
    .join('')}</ul>`;
}
