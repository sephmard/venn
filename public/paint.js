// The organizer's painter for "ask when people are available" polls: paint times, or parts of the day,
// on a week, and what that page does with them. Only the create pages load it, and only once the
// organizer zooms in from whole days, so most whole-day polls never do.

import { DAY_PARTS, addDays } from './core.js';
import { dayChip, isPhone } from './picker.js';
import { $, $$, dateParts, dayLabel, esc, fmtDow, fmtMonthDay, shortRange, shortTime, todayStr } from './ui.js';

const STEP = 30;

/**
 * Paint times on a week (desktop) or one day at a time (phones), in 30-minute rows. Drag to paint;
 * start on a painted time to erase. Tap a day's name to paint or clear the whole day.
 *   selected   Set of "YYYY-MM-DD|minutes", changed in place
 *   onChange() after each stroke
 *   from, to   minutes after midnight shown
 *   startAt    the first day to show (today or later)
 *   parts      instead of 30-minute rows, one row per part of the day ([{ start, label }] from DAY_PARTS);
 *              selected then holds "YYYY-MM-DD|<the part's start>"
 *   maybe      the selected keys that are only "if needed" for the organizer (a Set, changed in place):
 *              what's painted joins it while `marking()` is true, and leaves it otherwise
 * Returns { render, week() (the 7 days around what's shown), cleanup }.
 */
export function paintView(
  root,
  { selected, onChange, from = 420, to = 1440, startAt = null, parts = null, maybe = new Set(), marking = () => false },
) {
  const day = isPhone();
  let start = startAt && startAt > todayStr() ? startAt : todayStr(); // first day of the week strip
  let anchor = start; // first day shown; on phones, the day shown
  root.innerHTML = `
    <div class="tv-bar">
      <div class="tv-nav">
        <button type="button" class="icon-btn" data-pstep="-1" aria-label="Earlier">‹</button>
        <span class="tv-label" aria-live="polite"></span>
        <button type="button" class="icon-btn" data-pstep="1" aria-label="Later">›</button>
      </div>
    </div>
    <div class="tv-strip" role="group" aria-label="Days"${day ? '' : ' hidden'}></div>
    <div class="pg-scroll"><div class="pg" role="group" aria-label="Times. Use the arrow keys to move and Space to paint."></div></div>`;
  const grid = $('.pg', root);
  const strip = $('.tv-strip', root);
  const week = () => Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const shown = () => (day ? [anchor] : week());
  const key = (d, m) => `${d}|${m}`;
  const rows = parts ? parts.map((p) => p.start) : [];
  for (let m = from; !parts && m < to; m += STEP) rows.push(m);
  const part = (m) => parts.find((p) => p.start === m);
  const label = (m) => (parts ? part(m).label : shortTime(m));
  const span = (m) => shortRange(part(m).start, part(m).end);
  let scrolled = false;

  function render() {
    const ds = shown();
    $('.tv-label', root).textContent =
      ds.length > 1 ? `${fmtMonthDay.format(dateParts(ds[0]))} – ${fmtMonthDay.format(dateParts(ds.at(-1)))}` : dayLabel(ds[0]);
    $('[data-pstep="-1"]', root).disabled = start <= todayStr();
    if (day)
      strip.innerHTML = week()
        .map((d) => {
          const n = rows.filter((m) => selected.has(key(d, m))).length;
          return `<button type="button" class="tv-chip" data-pday="${d}" aria-pressed="${d === anchor}">${dayChip(d, n ? '✓' : '')}</button>`;
        })
        .join('');
    let h = '<span class="pg-corner"></span>';
    for (const d of ds)
      h += `<button type="button" class="pg-day" data-fill-day="${d}"><b>${esc(fmtDow.format(dateParts(d)))}</b> ${esc(fmtMonthDay.format(dateParts(d)))}<span class="sr-only">: paint or clear the whole day</span></button>`;
    rows.forEach((m, r) => {
      h += `<span class="pg-time${parts ? ' part' : ''}" aria-hidden="true">${parts || !(m % 60) ? esc(label(m)) : ''}</span>`;
      ds.forEach((d, c) => {
        const on = selected.has(key(d, m));
        h += `<span class="pg-cell${parts ? ' part' : m % 60 ? '' : ' hour'}${on ? ' on' : ''}${on && maybe.has(key(d, m)) ? ' maybe' : ''}" role="button" tabindex="${r || c ? -1 : 0}" data-d="${d}" data-m="${m}" data-r="${r}" data-c="${c}" aria-pressed="${on}" aria-label="${esc(`${dayLabel(d)}, ${label(m)}${parts ? ` ${span(m)}` : ''}`)}">${parts ? `<small aria-hidden="true">${esc(span(m))}</small>` : ''}</span>`;
      });
    });
    grid.style.gridTemplateColumns = `${parts ? 84 : 52}px repeat(${ds.length}, minmax(0, 1fr))`;
    grid.innerHTML = h;
    if (!scrolled) {
      scrolled = true;
      // Start at the first painted time, or late afternoon.
      const first = rows.findIndex((m) => [...selected].some((k) => k.endsWith(`|${m}`)));
      const row = $('.pg-cell', grid)?.offsetHeight || 24;
      $('.pg-scroll', root).scrollTop = Math.max(0, (first >= 0 ? first : rows.indexOf(1020)) - 1) * row;
    }
  }
  const refresh = () => {
    for (const el of $$('.pg-cell', grid)) {
      const k = key(el.dataset.d, +el.dataset.m);
      const on = selected.has(k);
      el.classList.toggle('on', on);
      el.classList.toggle('maybe', on && maybe.has(k));
      el.setAttribute('aria-pressed', on);
    }
  };

  // Painting: a rectangle from where the stroke started to where the pointer is.
  let drag = null;
  // A time painted on is available or if needed, by the brush; a time taken away forgets which.
  const add = (k) => {
    selected.add(k);
    if (marking()) maybe.add(k);
    else maybe.delete(k);
  };
  const drop = (k) => {
    selected.delete(k);
    maybe.delete(k);
  };
  const paint = (a, b) => {
    selected.clear();
    for (const k of drag.before) selected.add(k);
    maybe.clear();
    for (const k of drag.maybe) maybe.add(k);
    const ds = shown();
    for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
      for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
        if (ds[c] < todayStr()) continue;
        const k = key(ds[c], rows[r]);
        if (drag.erase) drop(k);
        else if (!selected.has(k)) add(k);
      }
    refresh();
  };
  const pos = (el) => ({ r: +el.dataset.r, c: +el.dataset.c });
  grid.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pg-cell');
    if (!el || e.button > 0) return;
    e.preventDefault();
    drag = { at: pos(el), before: new Set(selected), maybe: new Set(maybe), erase: el.classList.contains('on') };
    paint(drag.at, drag.at);
  });
  grid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pg-cell');
    if (el && grid.contains(el)) paint(drag.at, pos(el));
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    if (day) render();
    onChange();
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  // Keyboard: arrows move, Space or Enter paints or clears one time.
  grid.addEventListener('keydown', (e) => {
    const el = e.target.closest('.pg-cell');
    if (!el) return;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      const { r, c } = pos(el);
      const next = $(`.pg-cell[data-r="${r + moves[e.key][0]}"][data-c="${c + moves[e.key][1]}"]`, grid);
      if (next) {
        el.tabIndex = -1;
        next.tabIndex = 0;
        next.focus();
      }
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const k = key(el.dataset.d, +el.dataset.m);
      if (selected.has(k)) drop(k);
      else add(k);
      refresh();
      onChange();
    }
  });

  root.addEventListener('click', (e) => {
    const fill = e.target.closest('[data-fill-day]');
    if (fill) {
      const d = fill.dataset.fillDay;
      const all = rows.every((m) => selected.has(key(d, m)));
      for (const m of rows)
        if (all) drop(key(d, m));
        else if (!selected.has(key(d, m))) add(key(d, m));
      render();
      return onChange();
    }
    const st = e.target.closest('[data-pstep]');
    if (st) {
      start = addDays(start, 7 * +st.dataset.pstep);
      if (start < todayStr()) start = todayStr();
      anchor = start;
      return render();
    }
    const chip = e.target.closest('[data-pday]');
    if (chip) {
      anchor = chip.dataset.pday;
      render();
    }
  });
  render();
  return {
    render,
    week,
    cleanup() {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    },
  };
}

// ---------- the levels: whole days, parts of the day and hours ----------
// `st` is what the create page has picked at each level, { days, parts, hours } (Sets of
// "YYYY-MM-DD", "YYYY-MM-DD|<part start>" and "YYYY-MM-DD|minutes"), with `maybe` (the same, for
// what's only if needed for the organizer) and `defaultParts` (the parts a new day gets).

const ALL_DAY = [DAY_PARTS[0].start, DAY_PARTS.at(-1).end];
// Quick fills for the painter: parts of the day, painted on every day of the week shown. They're
// the same mornings, afternoons and evenings as "Parts of the day", so the levels agree.
const FILLS = [...DAY_PARTS.map((p) => [`${p.label}s`, p.start, p.end]), ['All day', ...ALL_DAY]];
const LEVELS = ['days', 'parts', 'hours'];
const slots = (from, to) => Array.from({ length: (to - from) / STEP }, (_, i) => from + i * STEP);
export const datesOf = (keys) => [...new Set([...keys].map((k) => k.split('|')[0]))].sort();
// The part of the day a painted half hour belongs to (the gaps between parts go to the nearest).
const partOfSlot = (m) => DAY_PARTS[m < 720 ? 0 : m < 1050 ? 1 : 2];
const partAt = (m) => DAY_PARTS.find((p) => p.start === +m);
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
    for (const d of days)
      if (!had.has(d)) for (const p of DAY_PARTS) if (st.defaultParts.has(p.key)) parts.add(`${d}|${p.start}`);
  } else {
    // Into hours: keep painted times in the parts (or days) still picked, and paint the rest whole.
    const keep = from === 'parts' ? (d, m) => parts.has(`${d}|${partOfSlot(m).start}`) : (d) => days.has(d);
    for (const k of [...hours]) {
      const [d, m] = k.split('|');
      if (!keep(d, +m)) hours.delete(k);
    }
    const want =
      from === 'parts'
        ? [...parts].map((k) => [k.split('|')[0], partAt(k.split('|')[1]).start, partAt(k.split('|')[1]).end])
        : [...days].map((d) => [d, ...ALL_DAY]);
    for (const [d, a, b] of want) {
      const ks = slots(a, b).map((m) => `${d}|${m}`);
      if (!ks.some((k) => hours.has(k))) for (const k of ks) hours.add(k);
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
  return ws.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

/** The keys a window in the list ("dates|from|to") stands for. */
export function windowKeys(level, value) {
  const [ds, from, to] = value.split('|');
  const mins = level === 'parts' ? [+from] : slots(+from, +to);
  return ds.split(',').flatMap((d) => mins.map((m) => `${d}|${m}`));
}
/** What a window's × asks before removing it from several days. */
export function windowWhat(level, value) {
  const [ds, from, to] = value.split('|');
  const n = ds.split(',').length;
  return level === 'parts' ? `these ${n} ${partAt(from).label.toLowerCase()}s` : `${shortRange(+from, +to)} on these ${n} days`;
}

/** The windows as a list: days in a row with the same times together, each time a chip. */
export function windowList(windows, level, chip, dayRange) {
  const label = level === 'parts' ? (a, b) => `${partAt(a).label} ${shortRange(a, b)}` : shortRange;
  const groups = [];
  for (const d of datesOf(windows.map((w) => w.date))) {
    const ranges = windows.filter((w) => w.date === d).map((w) => [w.start, w.end, !!w.maybe]);
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

/** How to paint, said above the calendar where it's read before the first stroke. */
export function paintHelp(parts) {
  const tap = isPhone() ? 'Tap' : 'Click';
  if (parts)
    return `${tap} a morning, afternoon or evening to add it or take it away, or drag across several. ${tap} a day name for the whole day.`;
  return isPhone()
    ? 'Drag down the calendar to paint; start on a painted time to erase. Tap a day name for the whole day. To scroll, drag the times on the left, or the page around the calendar.'
    : 'Drag across the calendar to paint; start on a painted time to erase. Click a day name for the whole day.';
}
/** The quick fills, for the week shown. */
export const fillPills = (parts) =>
  `<span class="scope-label">Fill this week:</span>${FILLS.map(
    ([l, a, b], i) =>
      `<button type="button" class="pill" data-fill="${i}">${l}${parts ? '' : ` <small>${esc(shortRange(a, b))}</small>`}</button>`,
  ).join('')}`;
/** A quick fill: that part of the day on every day of `week`, or cleared if it's all there. */
export function fillWeek(set, parts, i, week) {
  const [, from, to] = FILLS[i];
  const mins = parts ? DAY_PARTS.filter((p) => p.start >= from && p.start < to).map((p) => p.start) : slots(from, to);
  const keys = week.flatMap((d) => mins.map((m) => `${d}|${m}`));
  const all = keys.every((k) => set.has(k));
  for (const k of keys) all ? set.delete(k) : set.add(k);
}
