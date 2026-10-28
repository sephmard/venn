// Answering a whole-day poll on a month calendar of just the poll's days: tap a day for available,
// again for if needed, again to clear it. Days left blank count as unavailable. The poll page loads this when
// a guest opens a whole-day poll; the list of rows stays a tap away for anyone who prefers it.

import { IF_NEEDED, YES, addDays } from './core.js';
import { $, $$, dateParts, esc, fmtDowLong, fmtMonth } from './ui.js';

/** How to answer, the same key as the create page's calendars, plus unavailable: tapped a third time, or left blank. */
export const TAP_KEY = `<p class="hint tap-key"><span><span class="swatch swatch-yes" aria-hidden="true"></span>Tap: available</span><span><span class="swatch swatch-maybe" aria-hidden="true"></span>Tap again: if needed</span><span><span class="swatch swatch-no" aria-hidden="true"></span>Tap again, or leave blank: unavailable</span></p>`;

const CSS = `
.tap-key{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0 0 10px}
.tap-key>span{display:inline-flex;align-items:center;gap:6px}
.dcal{display:grid;gap:14px}
.dcal-month{margin:0 0 6px;font-size:1rem}
.dcal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.dcal-dow{text-align:center;font-size:.75rem;font-weight:600;color:var(--muted)}
.dcal-day{container-type:inline-size;display:grid;place-content:center;gap:3px;min-width:0;min-height:52px;padding:2px 1px;border-radius:12px;border:1.5px solid var(--cell-line);background:var(--surface-2);color:var(--text);font:inherit;font-weight:700;line-height:1;cursor:pointer}
.dcal-day small{font-size:min(.62rem,26cqi);line-height:1.05;overflow-wrap:normal}
.dcal-off{border-color:transparent;background:none;color:var(--muted);font-weight:400;cursor:default}
.dcal-day[data-v="${YES}"]{background:var(--yes);border-color:var(--yes);color:var(--yes-ink)}
.dcal-day[data-v="${IF_NEEDED}"]{background:var(--maybe);border-color:var(--maybe);color:var(--maybe-ink)}
.dcal-day.final{outline:2.5px solid var(--final);outline-offset:1px}
.dcal-day:focus-visible{outline:3px solid var(--text);outline-offset:2px;position:relative;z-index:1}
@media (hover:hover){.dcal-day:not(.dcal-off):hover{border-color:var(--accent)}}`;

/**
 * The poll's days as months of weeks, Sunday first: [{ month: 'YYYY-MM', weeks: [[date or null] × 7] }].
 * Only the weeks with a poll day in them are kept, so two weeks of days take two or three rows.
 * Days of other months are null, so a week that crosses into the next month carries on there.
 */
export function monthWeeks(dates) {
  const days = new Set(dates);
  const out = [];
  for (const d of [...days].sort()) {
    const month = d.slice(0, 7);
    let m = out.at(-1);
    if (m?.month !== month) out.push((m = { month, weeks: [], starts: new Set() }));
    const start = addDays(d, -new Date(`${d}T12:00:00Z`).getUTCDay());
    if (m.starts.has(start)) continue;
    m.starts.add(start);
    m.weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((x) => (x.slice(0, 7) === month ? x : null)));
  }
  return out.map(({ month, weeks }) => ({ month, weeks }));
}

/**
 * Where an arrow key goes from day `at`, among the poll's `days` (sorted): left and right to the
 * day before or after, up and down a week (or the nearest poll day that way), Home and End to the ends.
 * Returns null for other keys, and `at` itself at an edge.
 */
export function stepDay(days, at, key) {
  const i = days.indexOf(at);
  if (key === 'ArrowLeft') return days[Math.max(0, i - 1)];
  if (key === 'ArrowRight') return days[Math.min(days.length - 1, i + 1)];
  if (key === 'Home') return days[0];
  if (key === 'End') return days.at(-1);
  if (key === 'ArrowUp') return days.findLast((d) => d <= addDays(at, -7)) ?? at;
  if (key === 'ArrowDown') return days.find((d) => d >= addDays(at, 7)) ?? at;
  return null;
}

const fmtMonthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const STATE = { [YES]: ['true', 'Yes'], [IF_NEEDED]: ['mixed', 'If needed'] };

/**
 * Draw the calendar in `root`.
 *   days       [{ key, date }]: each poll day (YYYY-MM-DD) and the slot it answers
 *   value(key) the answer so far: YES, IF_NEEDED or 0
 *   onTap(key) a day was tapped (or Space / Enter on it)
 *   final(key) whether the day is part of the picked date
 * Returns { render() (show the answers again, keeping focus), cleanup() }.
 */
export function dayAnswer(root, { days, value, onTap, final = () => false }) {
  if (!document.getElementById('day-answer-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'day-answer-css', textContent: CSS }));
  const keyOf = new Map(days.map((d) => [d.date, String(d.key)]));
  const order = [...keyOf.keys()].sort();
  let current = order[0];
  const dows = Array.from(
    { length: 7 },
    (_, i) =>
      `<span class="dcal-dow" aria-hidden="true">${esc(new Date(Date.UTC(2023, 0, 1 + i)).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' }))}</span>`,
  ).join('');
  const day = (d) => {
    const n = +d.slice(8);
    if (!d || !keyOf.has(d)) return d ? `<span class="dcal-day dcal-off" aria-hidden="true">${n}</span>` : '<span></span>';
    const dt = dateParts(d);
    // The number is what's seen; the weekday and month are read out with it, then the answer.
    return `<button type="button" class="dcal-day" data-key="${esc(keyOf.get(d))}" data-date="${d}"><span class="sr-only">${esc(fmtDowLong.format(dt))} </span>${n}<span class="sr-only"> ${esc(fmtMonth.format(dt))}</span><small></small></button>`;
  };
  root.innerHTML = `${TAP_KEY}<div class="dcal">${monthWeeks(order)
    .map(
      ({ month, weeks }, i) => `<div>
        <h3 class="dcal-month" id="dcal-m${i}">${esc(fmtMonthYear.format(dateParts(`${month}-01`)))}</h3>
        <div class="dcal-grid" role="group" aria-labelledby="dcal-m${i}">${dows}${weeks
          .flat()
          .map((d) => day(d || ''))
          .join('')}</div>
      </div>`,
    )
    .join('')}</div>`;

  function render() {
    for (const b of $$('button.dcal-day', root)) {
      const v = value(b.dataset.key);
      const [pressed, text] = STATE[v] || ['false', ''];
      b.dataset.v = v || 0;
      b.setAttribute('aria-pressed', pressed);
      b.classList.toggle('final', final(b.dataset.key));
      b.tabIndex = b.dataset.date === current ? 0 : -1;
      $('small', b).innerHTML = text && `<span class="sr-only">, </span>${text}`;
    }
  }
  const go = (d) => {
    current = d;
    render();
    $(`button[data-date="${d}"]`, root)?.focus();
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button.dcal-day');
    if (!b) return;
    current = b.dataset.date;
    onTap(b.dataset.key);
  });
  // Arrow keys move between the days (one tab stop for the whole calendar); Space and Enter tap.
  root.addEventListener('keydown', (e) => {
    const b = e.target.closest('button.dcal-day');
    const to = b && stepDay(order, b.dataset.date, e.key);
    if (!to) return;
    e.preventDefault();
    go(to);
  });
  render();
  return { render, cleanup() {} };
}
