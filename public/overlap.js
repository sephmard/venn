// Everyone's answers as the Venn, on the poll page: each date, part of the day or option as a row
// with how many are available, if needed or unavailable, and where everyone overlaps in solid
// green. Hours polls get a card a day: the day as a timeline of half hours, and its best stretches.
// Tap a row for who's free (and, on the organizer's link, Pick).

import { IF_NEEDED, YES, allDaySpan, meetingEnd, partOf, rankTimes, utcToZoned } from './core.js';
import { avatar, dateParts, esc, fmtDay, plural, shortRange, shortTime } from './ui.js';
import { fmtTimeRange } from './when.js';

const KEY = `<p class="hint legend ov-legend"><span class="sw sw-y"></span>Available <span class="sw sw-m"></span>If needed <span class="sw sw-nc"></span>Unavailable</p>`;
const dayName = (d) => fmtDay.format(dateParts(d));
const chips = (names, cls) =>
  names.map((name) => `<span class="chip ${cls}">${avatar(name, 'av-xs')}${esc(name)}</span>`).join('');

/** Who answered what: a line each for available, if needed and unavailable, marked as in the key. */
const group = (names, cls, label) =>
  names.length
    ? `<div class="ov-group"><span class="ov-group-h"><span class="sw sw-${cls}" aria-hidden="true"></span>${label}</span><span class="chips">${chips(names, cls)}</span></div>`
    : '';

/** Available, if needed and unavailable, in proportion. */
const bar = (yes, maybe, no) =>
  [
    ['y', yes],
    ['m', maybe],
    ['n', no],
  ]
    .filter(([, k]) => k)
    .map(([c, k]) => `<i class="${c}" style="flex:${k}"></i>`)
    .join('');

/**
 * One row: r = { start, label, day, yes, maybe, no } (names), n people in all.
 * kind: 'all' (everyone's free), 'best' (the most overlap) or ''. Everyone can, some only if needed:
 * 'ifn', amber as in the key.
 */
function row(r, n, { kind, open, final, pick, mine }) {
  const [yes, maybe, no] = [r.yes.length, r.maybe.length, r.no.length];
  if (maybe && yes + maybe === n) kind = 'ifn';
  const whole = kind === 'all' || kind === 'ifn';
  const said = `${yes} of ${n} available${maybe ? `, ${maybe} if needed` : ''}${no ? `, ${no} unavailable` : ''}${kind === 'all' ? ". Everyone's free" : kind === 'ifn' ? '. Everyone can, some only if needed' : kind === 'best' ? '. The most overlap' : ''}`;
  return `<li class="ov-item${open ? ' open' : ''}">
    <button type="button" class="ov-row${kind ? ` ${kind}` : ''}${final ? ' final' : ''}" data-ov="${r.start}" aria-expanded="${open}">
      <span class="ov-when">${r.day ? `<span class="sr-only">${esc(dayName(r.day))}, </span>` : ''}${esc(r.label)}${final ? ' <span class="ov-picked">✓ Picked</span>' : ''}</span>
      <span class="ov-count">${kind === 'all' ? '✓ Everyone' : kind === 'ifn' ? 'Everyone, if needed' : `${yes + maybe} of ${n}`}${mine ? ` <span class="ov-mine">${esc(mine)}</span>` : ''}<span class="sr-only">. ${esc(said)}</span><span class="ov-chev" aria-hidden="true"></span></span>
      ${whole ? '' : `<span class="ov-bar" aria-hidden="true">${bar(yes, maybe, no)}</span>`}
    </button>
    ${open ? `<div class="ov-who">${group(r.yes, 'yes', 'Available')}${group(r.maybe, 'maybe', 'If needed')}${group(r.no, 'no', 'Unavailable')}${pick ? `<div class="ov-pick">${pick}</div>` : ''}</div>` : ''}
  </li>`;
}

/** The organizer's Pick, under who's free: it asks first (on the poll page), so a stray tap picks nothing. */
const pickBtn = (ev, start, what = 'time') =>
  ev.finalStart === start
    ? ''
    : `<button type="button" class="btn ov-pick-btn" data-pick="${start}">${ev.finalStart != null ? `Pick this ${what} instead` : `Pick this ${what}`}</button>`;

/**
 * ctx: { ev, people (with availability), tz, inspect (the open row's start), focus (a person, or null),
 *        windows ([{ start, end }]), days (whole-day poll), parts (parts-of-the-day poll),
 *        list (answered option by option, not hours), when(start, end) (how an option reads) }
 */
export function overlapHtml(ctx) {
  return ctx.list ? listHtml(ctx) : hoursHtml(ctx);
}

function listHtml({ ev, people, tz, inspect, focus, windows, days, parts, when }) {
  const n = people.length;
  const timed = parts || windows.every((w) => !allDaySpan(w.start, w.end, tz));
  const rows = windows.map((w) => {
    const p = parts && partOf(w.start, w.end, tz);
    const whole = allDaySpan(w.start, w.end, ev.timezone);
    const by = (v) => people.filter((x) => (v ? x.availability[w.start] === v : !x.availability[w.start])).map((x) => x.name);
    return {
      start: w.start,
      day: timed ? utcToZoned(w.start, whole ? ev.timezone : tz).date : null,
      label: !timed
        ? when(w.start, w.end)
        : p
          ? `${p.label} · ${shortRange(p.start, p.end)}`
          : whole
            ? 'All day'
            : fmtTimeRange(w.start, w.end, tz),
      yes: by(YES),
      maybe: by(IF_NEEDED),
      no: by(0),
    };
  });
  const can = (r) => r.yes.length + r.maybe.length;
  const top = Math.max(0, ...rows.map(can));
  const everyone = rows.filter((r) => r.yes.length === n).length;
  const what = days ? 'date' : parts ? 'time' : 'option';
  let day = null;
  const items = rows
    .map((r) => {
      const v = focus?.availability[r.start];
      const head = r.day && r.day !== day ? `<li class="ov-day"><h3>${esc(dayName((day = r.day)))}</h3></li>` : '';
      return `${head}${row(r, n, {
        kind: r.yes.length === n ? 'all' : top && can(r) === top ? 'best' : '',
        open: String(r.start) === String(inspect),
        final: r.start === ev.finalStart,
        pick: ev.isAdmin && pickBtn(ev, r.start, what),
        mine: focus && `${focus.name}: ${v === YES ? '✓' : v === IF_NEEDED ? '~' : '✕'}`,
      })}`;
    })
    .join('');
  const summary = everyone
    ? `<b>Everyone's free</b> on ${plural(everyone, what)}.`
    : top === n
      ? `<b>Everyone can make it</b> on ${plural(rows.filter((r) => can(r) === n).length, what)}, some only if needed.`
      : top
        ? `The most that overlap: <b>${top} of ${n}</b>.`
        : 'No overlap yet.';
  return `<p class="ov-summary">${summary}</p>${KEY}<ol class="ov-list" aria-label="Everyone's answers">${items}</ol>`;
}

function hoursHtml({ ev, people, tz, inspect }) {
  const n = people.length;
  const ranked = rankTimes(ev, ev.slots, people, Infinity);
  const score = (b) => b.yes.length + b.ifNeeded.length;
  const topCan = ranked[0] ? score(ranked[0]) : 0;
  const dayOf = (x) => utcToZoned(x, tz).date;
  const final = ev.finalStart;
  const finalEnd = final != null ? meetingEnd(ev, final) : null;
  const byDay = new Map();
  for (const x of [...ev.slots].sort((a, b) => a - b)) {
    if (!byDay.has(dayOf(x))) byDay.set(dayOf(x), []);
    byDay.get(dayOf(x)).push(x);
  }
  // Every day on the same scale, from the earliest time asked about to the latest, so the days line
  // up: 10 AM is in the same place on each.
  const mins = (x) => utcToZoned(x, tz).minutes;
  const lo = Math.min(...ev.slots.map(mins));
  const hi = Math.max(...ev.slots.map(mins)) + ev.slotMinutes;
  const scale = Array.from({ length: Math.max(1, (hi - lo) / ev.slotMinutes) }, (_, i) => lo + i * ev.slotMinutes);
  const cards = [...byDay]
    .map(([d, slots]) => {
      // The day's best: its top-ranked times, back-to-back ones with the same people joined up.
      const blocks = ranked.filter((b) => dayOf(b.start) === d);
      const first = blocks[0];
      const spans = [];
      for (const b of blocks
        .filter((x) => x.yes.length === first.yes.length && x.ifNeeded.length === first.ifNeeded.length)
        .sort((x, y) => x.start - y.start)) {
        const last = spans.at(-1);
        if (last && last.end >= b.start && `${last.yes}|${last.ifNeeded}` === `${b.yes}|${b.ifNeeded}`)
          last.end = Math.max(last.end, b.end);
        else spans.push({ ...b });
      }
      const all = !!first && first.yes.length === n;
      const hot = (x) => spans.some((sp) => x >= sp.start && x < sp.end);
      const at = new Map(slots.map((x) => [mins(x), x]));
      const cols = scale.map((m) => {
        const x = at.get(m);
        // Not asked about this day: an empty stretch of the track.
        if (x == null) return '<span class="ov-slot off"></span>';
        const yes = people.filter((p) => p.availability[x] === YES).length;
        const maybe = people.filter((p) => p.availability[x] === IF_NEEDED).length;
        const cls = `${hot(x) ? (all ? ' all' : ' hot') : ''}${final != null && x >= final && x < finalEnd ? ' final' : ''}`;
        // One colour a half hour, as in the key: green where everyone's available, amber where everyone
        // can but some only if needed, paler green the fewer can make it, bare where nobody can.
        const can = yes + maybe;
        const tone = yes === n ? ' everyone' : can === n ? ' ifn' : can ? ' some' : '';
        const a = can && can < n ? ` style="--a:${Math.round(25 + (50 * can) / n)}%"` : '';
        return `<span class="ov-slot${tone}${cls}"${a}></span>`;
      });
      // Hour marks under the timeline: every hour, or every two or three on a long day.
      const every = scale.length > 24 ? 180 : scale.length > 12 ? 120 : 60;
      const axis = scale.map((m) => (m % every ? '<span></span>' : `<span>${esc(shortTime(m))}</span>`)).join('');
      const said = spans.length
        ? `Best: ${spans.map((sp) => fmtTimeRange(sp.start, sp.end, tz)).join(' and ')}, ${score(first)} of ${n}${all ? ", everyone's free" : ''}`
        : 'Nobody is free this day yet';
      const rows = spans
        .slice(0, 3)
        .map((sp) =>
          row(
            {
              start: sp.start,
              day: d,
              label: fmtTimeRange(sp.start, sp.end, tz),
              yes: sp.yes,
              maybe: sp.ifNeeded,
              no: sp.no,
            },
            n,
            {
              kind: all ? 'all' : score(sp) === topCan ? 'best' : '',
              open: String(sp.start) === String(inspect),
              final: sp.start === final,
              pick: ev.isAdmin && pickBtn(ev, sp.start),
            },
          ),
        )
        .join('');
      return `<li class="ov-card"><h3>${esc(dayName(d))}</h3>
        <div class="ov-tl" role="img" aria-label="${esc(`${dayName(d)}: ${said}`)}">
          <div class="ov-cols">${cols.join('')}</div>
          <div class="ov-axis" aria-hidden="true" style="--n:${scale.length}">${axis}</div>
        </div>
        ${rows ? `<ol class="ov-list">${rows}</ol>` : '<p class="hint">Nobody is free this day yet.</p>'}</li>`;
    })
    .join('');
  const summary = ranked.some((b) => b.yes.length === n)
    ? "<b>Everyone's free</b> at the times in green."
    : topCan === n
      ? '<b>Everyone can make it</b> at the times outlined, some only if needed.'
      : topCan
        ? `The most that overlap: <b>${topCan} of ${n}</b>.`
        : 'No overlap yet.';
  return `<p class="ov-summary">${summary}</p>${KEY}<ol class="ov-days" aria-label="Everyone's answers, day by day">${cards}</ol>`;
}
