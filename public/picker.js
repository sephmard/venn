// Calendar views shared by organizers and guests.
//   monthView  a month of days: pick several (tap or drag), or open one day at a time
//   timeView   a week (desktop) or one day (phones) of 30-minute rows, with a Week / Day / Month switch.
//              Organizers draw options on it; guests see the options next to their busy times.

import { addDays } from './core.js';
import { $, $$, dateParts, dayLabel, esc, fmtDow, fmtMonthDay, shortRange, shortTime, todayStr } from './ui.js';

const STEP = 30;
export const isPhone = () => matchMedia('(max-width: 640px)').matches;

/** A day chip's content: "Sat 7" on screen, "Sat 7 Nov, 2" for screen readers. */
export const dayChip = (d, mark = '') =>
  `<small>${esc(fmtDow.format(dateParts(d)))}</small> <b>${dateParts(d).getUTCDate()}</b><span class="sr-only"> ${esc(fmtMonth.format(dateParts(d)))}${mark ? `, ${esc(mark)}` : ''}</span>${mark ? `<i aria-hidden="true">${esc(mark)}</i>` : ''}`;
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });

const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * A month calendar.
 * - Toggle mode (`selected` + `onChange`): tap or drag to pick several days.
 * - Open mode (`onDay`): tap a day to open it; `active()` is the open day.
 * `marks(date)` returns a short note shown under the day number (and read out with it).
 * `dayClass(date)` adds classes to a day, for ranges such as the days a trip covers.
 */
export function monthView(
  root,
  {
    selected,
    onChange,
    onDay,
    active = () => null,
    marks = () => '',
    markLabel = 'marked',
    allowed = () => true,
    dayClass = () => '',
  },
) {
  const today = todayStr();
  const toggle = !!selected;
  let cursor = new Date();
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  root.innerHTML = `
    <div class="cal-head">
      <button type="button" class="icon-btn" data-nav="-1" aria-label="Previous month">‹</button>
      <h3 class="cal-month" aria-live="polite"></h3>
      <button type="button" class="icon-btn" data-nav="1" aria-label="Next month">›</button>
    </div>
    <div class="cal-grid" role="group" aria-label="Dates"></div>`;
  const grid = $('.cal-grid', root);

  function render() {
    $('.cal-month', root).textContent = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const y = cursor.getFullYear(),
      m = cursor.getMonth();
    let h = Array.from(
      { length: 7 },
      (_, i) => `<span class="cal-dow" aria-hidden="true">${fmtDow.format(new Date(Date.UTC(2023, 0, 1 + i)))}</span>`,
    ).join('');
    h += '<span></span>'.repeat(new Date(y, m, 1).getDay());
    for (let d = 1, n = new Date(y, m + 1, 0).getDate(); d <= n; d++) {
      const ds = ymd(y, m, d);
      const mark = marks(ds);
      const state = toggle ? `aria-pressed="${selected.has(ds)}"` : ds === active() ? 'aria-current="date"' : '';
      const off = ds < today || !allowed(ds);
      // The number is the visible name; the weekday, month and note are read out with it.
      const dt = dateParts(ds);
      h += `<button type="button" class="cal-day${ds === today ? ' today' : ''}${mark ? ' marked' : ''} ${dayClass(ds)}" data-date="${ds}" ${state}${off ? ' disabled' : ''}><span class="sr-only">${esc(fmtDow.format(dt))} </span>${d}<span class="sr-only"> ${esc(fmtMonth.format(dt))}${mark ? `, ${esc(mark)} ${esc(markLabel)}` : ''}</span>${mark ? `<small aria-hidden="true">${esc(mark)}</small>` : ''}</button>`;
    }
    grid.innerHTML = h;
    $('[data-nav="-1"]', root).disabled = y === new Date().getFullYear() && m === new Date().getMonth();
  }

  // Toggle mode: drag across days with a mouse; a tap (or Enter/Space) toggles one.
  let drag = null;
  let pointer = null;
  const apply = (btn) => {
    if (!btn || btn.disabled || !btn.dataset.date) return;
    if (drag === 'add') selected.add(btn.dataset.date);
    else selected.delete(btn.dataset.date);
    btn.setAttribute('aria-pressed', drag === 'add');
  };
  grid.addEventListener('pointerdown', (e) => {
    pointer = e.pointerType;
    const btn = e.target.closest('.cal-day');
    if (!toggle || !btn || btn.disabled || e.pointerType !== 'mouse') return;
    e.preventDefault();
    drag = selected.has(btn.dataset.date) ? 'remove' : 'add';
    apply(btn);
  });
  grid.addEventListener('pointermove', (e) => {
    if (drag) apply(document.elementFromPoint(e.clientX, e.clientY)?.closest('.cal-day'));
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    onChange();
  };
  window.addEventListener('pointerup', end);
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.cal-day');
    if (!btn || btn.disabled) return;
    if (!toggle) return onDay(btn.dataset.date);
    if (pointer === 'mouse') return;
    pointer = null;
    drag = selected.has(btn.dataset.date) ? 'remove' : 'add';
    apply(btn);
    drag = null;
    onChange();
  });
  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (!nav) return;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + +nav.dataset.nav, 1);
    render();
  });
  render();
  return {
    render,
    show(date) {
      cursor = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, 1);
      render();
    },
    cleanup: () => window.removeEventListener('pointerup', end),
  };
}

/**
 * A grid of 30-minute rows for one or more days, with blocks drawn on it.
 *   dates()    the columns (YYYY-MM-DD)
 *   range()    [from, to] minutes after midnight shown
 *   blocks()   [{ key, date, from, to, cls, label, short, title }] positioned in local minutes;
 *              `short` replaces `label` when blocks share the width
 *   busy()     [{ date, from, to }] shown behind the blocks
 *   onCreate(date, from, to)  drag (mouse) or tap (touch, keyboard-free) on an empty spot; omit for read-only
 *   onBlock(key)              tap a block
 *   editBlocks, onResize(key, from, to), onMove(key, date, from, to)  dragging blocks (block-edit.js)
 *   tapLength()               minutes for a tap
 */
function timeGrid(
  root,
  { dates, range, blocks, busy = () => [], onCreate, onBlock, onResize, onMove, editBlocks, tapLength = () => 60 },
) {
  let scrollTop = null;
  let shownDates = '';
  function render() {
    const ds = dates();
    // Keep the scroll position while editing; jump to the first option when the days change.
    if (ds.join() !== shownDates) scrollTop = null;
    shownDates = ds.join();
    const [from, to] = range();
    const rows = (to - from) / STEP;
    const at = (m) => (m - from) / STEP;
    const prev = $('.tg-scroll', root);
    if (prev && scrollTop !== null) scrollTop = prev.scrollTop;
    const head = ds
      .map(
        (d) => `<span class="tg-day"><b>${esc(fmtDow.format(dateParts(d)))}</b> ${esc(fmtMonthDay.format(dateParts(d)))}</span>`,
      )
      .join('');
    let times = '';
    for (let m = from; m < to; m += 60) times += `<span style="top:calc(${at(m)} * var(--row))">${esc(shortTime(m))}</span>`;
    const pos = (a, b) =>
      `top:calc(${at(Math.max(a, from))} * var(--row));height:calc(${(Math.min(b, to) - Math.max(a, from)) / STEP} * var(--row))`;
    const all = blocks();
    const cols = ds
      .map((d) => {
        const bz = busy()
          .filter((b) => b.date === d && b.to > from && b.from < to)
          .map((b) => `<span class="tg-busy" style="${pos(b.from, b.to)}" aria-hidden="true">Busy</span>`)
          .join('');
        // Overlapping blocks sit side by side, in lanes, like a calendar app.
        const day = all.filter((b) => b.date === d && b.to > from && b.from < to).sort((x, y) => x.from - y.from || y.to - x.to);
        const ends = [];
        const lane = day.map((b) => {
          let i = ends.findIndex((end) => end <= b.from);
          if (i < 0) i = ends.length;
          ends[i] = b.to;
          return i;
        });
        const n = Math.max(1, ends.length);
        const bl = day
          .map(
            (b, i) =>
              `<button type="button" class="tg-block ${b.cls || ''}" data-key="${esc(b.key)}" style="${pos(b.from, b.to)};left:calc(3px + (100% - 6px) * ${lane[i]} / ${n});width:calc((100% - 6px) / ${n} - 2px)" aria-label="${esc(b.title || b.label)}">${editor?.top || ''}<span>${esc(n > 1 && b.short ? b.short : b.label)}</span>${editor?.bottom || ''}</button>`,
          )
          .join('');
        return `<div class="tg-col${onCreate ? ' tg-draw' : ''}" data-date="${d}">${bz}${bl}</div>`;
      })
      .join('');
    root.innerHTML = `
      <div class="tg" style="--cols:${ds.length};--rows:${rows}">
        ${ds.length > 1 ? `<div class="tg-head" aria-hidden="true"><span></span>${head}</div>` : ''}
        <div class="tg-scroll" tabindex="0" role="region" aria-label="Calendar times">
          <div class="tg-body"><div class="tg-times" aria-hidden="true">${times}</div>${cols}</div>
        </div>
      </div>`;
    const sc = $('.tg-scroll', root);
    if (scrollTop != null) sc.scrollTop = scrollTop;
    else {
      // Start at the first block, or the early evening when there's none.
      const first = all.filter((b) => ds.includes(b.date)).sort((a, b) => a.from - b.from)[0];
      sc.scrollTop = Math.max(0, at(first ? first.from - 60 : 1020)) * rowPx(root);
    }
  }

  const rowPx = (el) => parseFloat(getComputedStyle($('.tg', el) || el).getPropertyValue('--row')) || 24;
  const minuteAt = (col, y) => {
    const [from, to] = range();
    const r = Math.floor((y - col.getBoundingClientRect().top) / rowPx(root));
    return Math.min(to - STEP, Math.max(from, from + r * STEP));
  };

  const editor = editBlocks?.(root, { blocks, range, minuteAt, rowPx, onResize, onMove });

  // Mouse: drag to draw a block. Touch: a tap drops a block of the chosen length (dragging scrolls).
  let drag = null;
  let pointer = null;
  root.addEventListener('pointerdown', (e) => {
    pointer = e.pointerType;
    if (editor?.active()) return;
    const col = e.target.closest('.tg-draw');
    if (!onCreate || !col || e.target.closest('.tg-block') || e.pointerType !== 'mouse' || e.button > 0) return;
    e.preventDefault();
    const a = minuteAt(col, e.clientY);
    const ghost = document.createElement('span');
    ghost.className = 'tg-block tg-ghost';
    col.append(ghost);
    drag = { col, a, b: a, ghost, moved: false };
    paintGhost();
  });
  const paintGhost = () => {
    const [from] = range();
    const [lo, hi] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b) + STEP];
    drag.ghost.style.top = `calc(${(lo - from) / STEP} * var(--row))`;
    drag.ghost.style.height = `calc(${(hi - lo) / STEP} * var(--row))`;
    drag.ghost.textContent = shortRange(lo, hi);
  };
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const b = minuteAt(drag.col, e.clientY);
    if (b !== drag.b) {
      drag.b = b;
      drag.moved = true;
      paintGhost();
    }
  });
  const up = () => {
    if (!drag) return;
    const { col, a, b, moved } = drag;
    drag = null;
    const lo = Math.min(a, b);
    onCreate(col.dataset.date, lo, moved ? Math.max(a, b) + STEP : Math.min(lo + tapLength(), 1440));
  };
  window.addEventListener('pointerup', up);
  root.addEventListener('click', (e) => {
    if (editor?.takeClick()) return;
    const block = e.target.closest('.tg-block[data-key]');
    if (block) return onBlock?.(block.dataset.key);
    const col = e.target.closest('.tg-draw');
    if (!onCreate || !col || pointer === 'mouse') return;
    const a = minuteAt(col, e.clientY);
    onCreate(col.dataset.date, a, Math.min(a + tapLength(), 1440));
  });
  return {
    render,
    cleanup() {
      window.removeEventListener('pointerup', up);
      editor?.cleanup();
    },
  };
}

/**
 * Week / Day (and optionally Month) views with navigation.
 *   days       fixed list of days to page through (guests), or null to roam freely from today (organizers)
 *   month      optional (container) => cleanup: renders the month view
 *   marks(d)   short note for a day in the day strip ("2", "Eve")
 * Plus the timeGrid options.
 */
export function timeView(root, opts) {
  const { days = null, month = null, marks = () => '', label = 'Calendar' } = opts;
  const views = opts.views || ['week', 'day', ...(month ? ['month'] : [])];
  let view = opts.view || (isPhone() && views.includes('day') ? 'day' : views[0]);
  let anchor = days ? 0 : todayStr(); // index into days, or a date
  let monthCleanup = null;

  root.innerHTML = `
    <div class="tv-bar">
      <div class="seg tv-views" role="radiogroup" aria-label="${esc(label)} view"${views.length > 1 ? '' : ' hidden'}>
        ${views.map((v) => `<button type="button" role="radio" data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
      </div>
      <div class="tv-nav">
        <button type="button" class="icon-btn" data-step="-1" aria-label="Earlier">‹</button>
        <span class="tv-label" aria-live="polite"></span>
        <button type="button" class="icon-btn" data-step="1" aria-label="Later">›</button>
      </div>
    </div>
    <div class="tv-strip" role="group" aria-label="Days"></div>
    <div class="tv-grid"></div>
    <div class="tv-month"></div>`;
  const gridEl = $('.tv-grid', root);
  const monthEl = $('.tv-month', root);
  const strip = $('.tv-strip', root);

  const shown = () => {
    if (days) return view === 'week' ? days.slice(anchor, anchor + 7) : [days[anchor]];
    if (view === 'day') return [anchor];
    return Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  };
  const grid = timeGrid(gridEl, { ...opts, dates: shown });

  function render() {
    for (const b of $$('[data-view]', root)) b.setAttribute('aria-checked', b.dataset.view === view);
    $('.tv-nav', root).hidden = view === 'month';
    monthCleanup?.();
    monthCleanup = null;
    gridEl.hidden = view === 'month';
    monthEl.hidden = view !== 'month';
    if (view === 'month') {
      strip.hidden = true;
      // A fresh element each time, so the month view's listeners go away with it.
      const fresh = document.createElement('div');
      monthEl.replaceChildren(fresh);
      monthCleanup = month(fresh);
      return;
    }
    const ds = shown();
    $('.tv-label', root).textContent =
      ds.length > 1 ? `${fmtMonthDay.format(dateParts(ds[0]))} – ${fmtMonthDay.format(dateParts(ds.at(-1)))}` : dayLabel(ds[0]);
    const first = days ? anchor === 0 : ds[0] <= todayStr();
    $('[data-step="-1"]', root).disabled = first;
    $('[data-step="1"]', root).disabled = days ? anchor + (view === 'week' ? 7 : 1) >= days.length : false;
    // On the day view, a strip of nearby days to jump between.
    strip.hidden = view !== 'day';
    if (view === 'day') {
      const near = days || Array.from({ length: 7 }, (_, i) => addDays(anchor, i - ((dateParts(anchor).getUTCDay() + 7) % 7)));
      strip.innerHTML = near
        .map((d) => {
          const m = marks(d);
          return `<button type="button" class="tv-chip" data-day="${d}" aria-pressed="${d === ds[0]}"${!days && d < todayStr() ? ' disabled' : ''}>${dayChip(d, m)}</button>`;
        })
        .join('');
    }
    grid.render();
  }

  root.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]');
    if (v && root.contains(v)) {
      view = v.dataset.view;
      return render();
    }
    const st = e.target.closest('.tv-nav [data-step]');
    if (st) {
      const n = (view === 'week' ? 7 : 1) * +st.dataset.step;
      anchor = days ? Math.max(0, Math.min(days.length - 1, anchor + n)) : addDays(anchor, n);
      if (!days && anchor < todayStr()) anchor = todayStr();
      return render();
    }
    const chip = e.target.closest('[data-day]');
    if (chip) {
      anchor = days ? days.indexOf(chip.dataset.day) : chip.dataset.day;
      render();
    }
  });
  render();
  return {
    render,
    /** Show a given day (organizers jumping from the month view to an exact time). */
    show(date, as = view) {
      view = as;
      anchor = days ? Math.max(0, days.indexOf(date)) : date < todayStr() ? todayStr() : date;
      render();
    },
    get view() {
      return view;
    },
    cleanup() {
      grid.cleanup();
      monthCleanup?.();
    },
  };
}

/**
 * Paint times on a week (desktop) or one day at a time (phones), in 30-minute rows. Drag to paint;
 * start on a painted time to erase. Tap a day's name to paint or clear the whole day.
 *   selected   Set of "YYYY-MM-DD|minutes", changed in place
 *   onChange() after each stroke
 *   from, to   minutes after midnight shown
 *   startAt    the first day to show (today or later)
 * Returns { render, week() (the 7 days around what's shown), cleanup }.
 */
export function paintView(root, { selected, onChange, from = 420, to = 1440, startAt = null }) {
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
  const rows = [];
  for (let m = from; m < to; m += STEP) rows.push(m);
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
      h += `<span class="pg-time" aria-hidden="true">${m % 60 ? '' : esc(shortTime(m))}</span>`;
      ds.forEach((d, c) => {
        const on = selected.has(key(d, m));
        h += `<span class="pg-cell${m % 60 ? '' : ' hour'}${on ? ' on' : ''}" role="button" tabindex="${r || c ? -1 : 0}" data-d="${d}" data-m="${m}" data-r="${r}" data-c="${c}" aria-pressed="${on}" aria-label="${esc(`${dayLabel(d)}, ${shortTime(m)}`)}"></span>`;
      });
    });
    grid.style.gridTemplateColumns = `52px repeat(${ds.length}, minmax(0, 1fr))`;
    grid.innerHTML = h;
    if (!scrolled) {
      scrolled = true;
      // Start at the first painted time, or late afternoon.
      const first = rows.findIndex((m) => [...selected].some((k) => k.endsWith(`|${m}`)));
      const row = $('.pg-cell', grid)?.offsetHeight || 22;
      $('.pg-scroll', root).scrollTop = Math.max(0, (first >= 0 ? first : rows.indexOf(1020)) - 1) * row;
    }
  }
  const refresh = () => {
    for (const el of $$('.pg-cell', grid)) {
      const on = selected.has(key(el.dataset.d, +el.dataset.m));
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', on);
    }
  };

  // Painting: a rectangle from where the stroke started to where the pointer is.
  let drag = null;
  const paint = (a, b) => {
    selected.clear();
    for (const k of drag.before) selected.add(k);
    const ds = shown();
    for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
      for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
        if (ds[c] < todayStr()) continue;
        const k = key(ds[c], rows[r]);
        if (drag.erase) selected.delete(k);
        else selected.add(k);
      }
    refresh();
  };
  const pos = (el) => ({ r: +el.dataset.r, c: +el.dataset.c });
  grid.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pg-cell');
    if (!el || e.button > 0) return;
    e.preventDefault();
    drag = { at: pos(el), before: new Set(selected), erase: el.classList.contains('on') };
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
      if (selected.has(k)) selected.delete(k);
      else selected.add(k);
      refresh();
      onChange();
    }
  });

  root.addEventListener('click', (e) => {
    const fill = e.target.closest('[data-fill-day]');
    if (fill) {
      const d = fill.dataset.fillDay;
      const all = rows.every((m) => selected.has(key(d, m)));
      for (const m of rows) all ? selected.delete(key(d, m)) : selected.add(key(d, m));
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
