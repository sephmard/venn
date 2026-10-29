// The organizer's painter for "ask when people are available" polls: paint times, or parts of the day,
// on a week, and what that page does with them. Only the create pages load it, and only once the
// organizer zooms in from whole days, so most whole-day polls never do.

import { DAY_PARTS, addDays } from './core.js';
import { addMonths, dayChip, isPhone, tinyTime } from './picker.js';
import { $, $$, dateParts, dayHead, dayLabel, esc, fmtMonthDay, shortRange, shortTime, todayStr } from './ui.js';

const STEP = 30;

/**
 * Paint times on a week (desktop) or one day at a time (phones), in 30-minute rows. Drag to paint;
 * start on a painted time to erase. A tap goes round: picked, then if needed, then taken away. Tap
 * a day's name to paint or clear the whole day.
 *   selected   Set of "YYYY-MM-DD|minutes", changed in place
 *   onChange() after each stroke
 *   from, to   minutes after midnight shown
 *   startAt    the first day to show (today or later)
 *   parts      instead of 30-minute rows, one row per part of the day ([{ start, label }] from DAY_PARTS);
 *              selected then holds "YYYY-MM-DD|<the part's start>"
 *   maybe      the selected keys that are only "if needed" for the organizer (a Set, changed in place):
 *              what's painted joins it while `marking()` is true, and leaves it otherwise
 *   views      ['week', 'day'] adds a Week / Day switch; ['week'], the week everywhere; without it, phones
 *              show a day and others a week
 *   drag       false: times are tapped one at a time, and a swipe scrolls the page
 * Returns { render, week() (the 7 days around what's shown), cleanup }.
 */
export function paintView(
  root,
  {
    selected,
    onChange,
    onRender = () => {},
    from = 420,
    to = 1440,
    startAt = null,
    parts = null,
    maybe = new Set(),
    marking = () => false,
    views = null,
    drag: canDrag = true,
  },
) {
  let day = views?.length === 1 ? views[0] === 'day' : isPhone();
  // Weeks run Monday to Sunday; days before today show, but can't be painted.
  const monday = (d) => addDays(d, -((dateParts(d).getUTCDay() + 6) % 7));
  const thisWeek = monday(todayStr());
  let start = monday(startAt && startAt > todayStr() ? startAt : todayStr()); // the Monday of the week shown
  let anchor = startAt && startAt > todayStr() ? startAt : todayStr(); // on phones, the day shown
  root.innerHTML = `
    <div class="tv-bar">
      ${
        views?.length > 1
          ? `<div class="seg tv-views" role="radiogroup" aria-label="Calendar view">${views
              .map((v) => `<button type="button" role="radio" data-pview="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`)
              .join('')}</div>`
          : ''
      }
      <div class="tv-nav">
        <button type="button" class="icon-btn" data-pmonth="-1" aria-label="Back a month">«</button>
        <button type="button" class="icon-btn" data-pstep="-1" aria-label="Earlier">‹</button>
        <span class="tv-label" aria-live="polite"></span>
        <button type="button" class="icon-btn" data-pstep="1" aria-label="Later">›</button>
        <button type="button" class="icon-btn" data-pmonth="1" aria-label="Forward a month">»</button>
      </div>
    </div>
    <div class="tv-strip" role="group" aria-label="Days"${day ? '' : ' hidden'}></div>
    <div class="pg-scroll"><div class="pg" role="group" aria-label="Times. Use the arrow keys to move. Space picks a time, makes it if needed, then takes it away."></div></div>`;
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
    for (const b of $$('[data-pview]', root)) b.setAttribute('aria-checked', (b.dataset.pview === 'day') === day);
    strip.hidden = !day;
    // A whole week on a phone: narrow columns, so the cells show their colour and the times sit at the side.
    const narrow = !day && isPhone();
    grid.classList.toggle('pg-narrow', narrow);
    $('.tv-label', root).textContent =
      ds.length > 1 ? `${fmtMonthDay.format(dateParts(ds[0]))} – ${fmtMonthDay.format(dateParts(ds.at(-1)))}` : dayLabel(ds[0]);
    $('[data-pstep="-1"]', root).disabled = $('[data-pmonth="-1"]', root).disabled = start <= thisWeek;
    if (day)
      strip.innerHTML = week()
        .map((d) => {
          const n = rows.filter((m) => selected.has(key(d, m))).length;
          return `<button type="button" class="tv-chip" data-pday="${d}" aria-pressed="${d === anchor}"${d < todayStr() ? ' disabled' : ''}>${dayChip(d, n ? '✓' : '')}</button>`;
        })
        .join('');
    let h = '<span class="pg-corner"></span>';
    for (const d of ds)
      h += `<button type="button" class="pg-day day-head${d === todayStr() ? ' today' : ''}" data-fill-day="${d}"${d < todayStr() ? ' disabled' : ''}>${dayHead(d)}<span class="sr-only">${d < todayStr() ? ': past' : ': paint or clear the whole day'}</span></button>`;
    rows.forEach((m, r) => {
      h += `<span class="pg-time${parts ? ' part' : ''}" aria-hidden="true">${parts || !(m % 60) ? esc(label(m)) : ''}</span>`;
      ds.forEach((d, c) => {
        const on = selected.has(key(d, m));
        // What a picked part is for the organizer, shown on it: " If needed" or " Available".
        const tag = parts && on ? (maybe.has(key(d, m)) ? ' If needed' : ' Available') : '';
        h += `<span class="pg-cell${parts ? ' part' : m % 60 ? '' : ' hour'}${on ? ' on' : ''}${on && maybe.has(key(d, m)) ? ' maybe' : ''}${d < todayStr() ? ' past" aria-disabled="true' : ''}" role="button" tabindex="${r || c ? -1 : 0}" data-d="${d}" data-m="${m}" data-r="${r}" data-c="${c}" aria-pressed="${on}" aria-label="${esc(`${dayLabel(d)}, ${label(m)}${parts ? ` ${span(m)}${tag}` : on && maybe.has(key(d, m)) ? ', if needed' : ''}`)}">${parts ? `<small aria-hidden="true"${narrow ? ` data-a="${tinyTime(part(m).start)}" data-b="${tinyTime(part(m).end)}">` : `>${esc(span(m))}`}</small>${tag ? ` <small class="pg-tag" aria-hidden="true">${tag.trim()}</small>` : ''}` : ''}</span>`;
      });
    });
    grid.style.gridTemplateColumns = `${parts ? (narrow ? 30 : 52) : narrow ? 40 : 52}px repeat(${ds.length}, minmax(0, 1fr))`;
    grid.innerHTML = h;
    if (!scrolled) {
      scrolled = true;
      // Start at the first painted time, or late afternoon.
      const first = rows.findIndex((m) => [...selected].some((k) => k.endsWith(`|${m}`)));
      const row = $('.pg-cell', grid)?.offsetHeight || 24;
      $('.pg-scroll', root).scrollTop = Math.max(0, (first >= 0 ? first : rows.indexOf(1020)) - 1) * row;
    }
    onRender();
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
  /** One time, tapped (or Space): picked → if needed → taken away. */
  const cycle = (k) => {
    if (!selected.has(k)) add(k);
    else if (!maybe.has(k)) maybe.add(k);
    else drop(k);
  };
  grid.classList.toggle('pg-tap', !canDrag);
  grid.addEventListener('click', (e) => {
    const el = !canDrag && e.target.closest('.pg-cell');
    if (!el || el.classList.contains('past')) return;
    cycle(key(el.dataset.d, +el.dataset.m));
    render();
    onChange();
  });
  grid.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pg-cell');
    if (!canDrag || !el || e.button > 0 || el.classList.contains('past')) return;
    e.preventDefault();
    const erase = el.classList.contains('on');
    drag = { at: pos(el), el, before: new Set(selected), maybe: new Set(maybe), erase, moved: false };
    // A picked time waits to see whether this is a tap (which goes round) or a drag (which erases).
    if (!erase) paint(drag.at, drag.at);
  });
  grid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pg-cell');
    if (!el || !grid.contains(el) || (el === drag.el && !drag.moved)) return;
    drag.moved = true;
    paint(drag.at, pos(el));
  });
  const end = () => {
    if (!drag) return;
    if (drag.erase && !drag.moved) {
      cycle(key(drag.el.dataset.d, +drag.el.dataset.m));
      refresh();
    }
    drag = null;
    render(); // the labels say what each time is now, as well as the colours
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
    } else if ((e.key === ' ' || e.key === 'Enter') && !el.classList.contains('past')) {
      e.preventDefault();
      cycle(key(el.dataset.d, +el.dataset.m));
      const { r, c } = pos(el);
      render();
      for (const x of $$('.pg-cell', grid)) x.tabIndex = -1;
      const again = $(`.pg-cell[data-r="${r}"][data-c="${c}"]`, grid);
      again.tabIndex = 0;
      again.focus();
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
    const pv = e.target.closest('[data-pview]');
    if (pv) {
      day = pv.dataset.pview === 'day';
      if (day && !week().includes(anchor)) anchor = start < todayStr() ? todayStr() : start;
      return render();
    }
    // ‹ › a week, « » a month: the week with the same day a month on (never before this week).
    const mo = e.target.closest('[data-pmonth]');
    const st = e.target.closest('[data-pstep]');
    if (st || mo) {
      start = st ? addDays(start, 7 * +st.dataset.pstep) : monday(addMonths(start, +mo.dataset.pmonth));
      if (start < thisWeek) start = thisWeek;
      anchor = start < todayStr() ? todayStr() : start;
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
    for (const d of days)
      if (!had.has(d)) for (const p of DAY_PARTS) if (st.defaultParts.has(p.key)) parts.add(`${d}|${p.start}`);
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
export function windowList(windows, level, chip, dayRange) {
  const label =
    level === 'parts' ? (a, b) => (partAt(a)?.end === b ? `${partAt(a).label} ${shortRange(a, b)}` : 'All day') : hoursLabel;
  const groups = [];
  for (const d of datesOf(windows.map((w) => w.date))) {
    let ranges = windows.filter((w) => w.date === d).map((w) => [w.start, w.end, !!w.maybe]);
    // Every part of the day, all the same, is the whole day: one chip.
    if (level === 'parts' && ranges.length === DAY_PARTS.length && ranges.every((r) => r[2] === ranges[0][2]))
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
