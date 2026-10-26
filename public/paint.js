// The organizer's painter for "ask when people are free" polls: paint times, or parts of the day,
// on a week. Only the create pages load it.

import { addDays } from './core.js';
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
 * Returns { render, week() (the 7 days around what's shown), cleanup }.
 */
export function paintView(root, { selected, onChange, from = 420, to = 1440, startAt = null, parts = null }) {
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
        h += `<span class="pg-cell${parts ? ' part' : m % 60 ? '' : ' hour'}${on ? ' on' : ''}" role="button" tabindex="${r || c ? -1 : 0}" data-d="${d}" data-m="${m}" data-r="${r}" data-c="${c}" aria-pressed="${on}" aria-label="${esc(`${dayLabel(d)}, ${label(m)}${parts ? ` ${span(m)}` : ''}`)}">${parts ? `<small aria-hidden="true">${esc(span(m))}</small>` : ''}</span>`;
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
