// Calendar views shared by organizers and guests.
//   monthView  a month of days: pick several (tap or drag), or open one day at a time
// (timeView, the week or day of 30-minute rows, is time-view.js.)

import { addDays } from './core.js';
import { $, $$, dateParts, dayChip, esc, fmtDow, fmtMonth, fmtMonthDay, isPhone, todayStr } from './ui.js';

export { dayChip, isPhone };

export const STEP = 30;
export const HOLD = 300; // ms a finger rests before it draws or moves instead of scrolling
/** Phones, and touch screens up to a tablet's width: the calendars open on one day. */
export const touchFirst = () => matchMedia('(max-width: 640px), (pointer: coarse) and (max-width: 1024px)').matches;

/** A sideways swipe on `el` drags the next (or last) week or month in beside it, and lets go onto
 * it: ‹ or › (sel(n) in root). A rest first is a drag. The first calendar on a touch screen nudges
 * once, until a swipe. */
let hinted = false;
export function swipe(el, root, sel) {
  let t, ghost, settle, nudge; // ghost: a still copy of what was shown, beside what's next
  const btn = (dir) => $(sel(dir), root);
  const box = el.parentElement;
  const put = (node, x, ms = 0) => {
    node.style.transition = ms ? `transform ${ms}ms ease-out` : 'none';
    node.style.transform = x ? `translateX(${x}px)` : '';
  };
  const done = () => (ghost.remove(), (ghost = null), box.classList.remove('swiping'), put(el, 0));
  const later = (f, ms) => {
    const id = setTimeout((settle = () => (clearTimeout(id), (settle = null), f())), ms);
  };
  el.addEventListener(
    'touchstart',
    (e) => {
      settle?.();
      clearTimeout(nudge);
      el.classList.remove('swipe-hint');
      t = e.touches.length < 2 && { p: e.touches[0], at: e.timeStamp };
      // The touch stays with what it began on, even once the next week has replaced it.
      const ac = new AbortController();
      const o = { passive: true, signal: ac.signal };
      e.target.addEventListener('touchmove', move, { passive: false, signal: ac.signal });
      for (const k of ['touchend', 'touchcancel']) e.target.addEventListener(k, (ev) => (ac.abort(), end(ev)), o);
    },
    { passive: true },
  );
  const move = (e) => {
    const [p, ms] = [e.touches[0], e.timeStamp];
    if (!t) return;
    const [dx, dy] = [p.clientX - t.p.clientX, p.clientY - t.p.clientY];
    // Sideways wins up to about 55° from level; once it has, the page holds still under it.
    if (!t.go && Math.hypot(dx, dy) > 8) t = ms - t.at < HOLD - 50 && { ...t, go: Math.abs(dx) > 0.7 * Math.abs(dy) };
    if (!t?.go) return;
    if (e.cancelable) e.preventDefault();
    if (!t.dir) {
      const dir = dx < 0 ? 1 : -1;
      if (!btn(dir) || btn(dir).disabled) return put(el, dx / 4); // nothing that way: it gives a little
      Object.assign(t, { dir, w: el.offsetWidth + 16 });
      ghost = el.cloneNode(true);
      ghost.inert = true;
      ghost.ariaHidden = 'true';
      for (const n of ghost.querySelectorAll('[id]')) n.removeAttribute('id');
      box.classList.add('swiping');
      ghost.style.cssText += `;position:absolute;left:${el.offsetLeft}px;top:${el.offsetTop}px;width:${el.offsetWidth}px;height:${el.offsetHeight}px;margin:0`;
      box.append(ghost);
      const to = [ghost, ...ghost.querySelectorAll('*')];
      [el, ...el.querySelectorAll('*')].forEach((n, i) => n.scrollTop && (to[i].scrollTop = n.scrollTop));
      btn(dir).click();
    }
    t.x = t.dir > 0 ? Math.max(-t.w, Math.min(0, dx)) : Math.min(t.w, Math.max(0, dx));
    put(ghost, t.x);
    put(el, t.x + t.dir * t.w);
  };
  const end = (e) => {
    const was = t;
    t = null;
    if (!was?.go) return;
    if (!was.dir) return put(el, 0, 200);
    const fast = Math.abs(was.x) > 40 && Math.abs(was.x) / (e.timeStamp - was.at) > 0.3;
    const keep = e.type === 'touchend' && (Math.abs(was.x) > was.w / 4 || fast);
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200;
    if (keep) {
      hinted = true;
      try {
        localStorage.setItem('venn:swiped', '1');
      } catch {}
    }
    put(ghost, keep ? -was.dir * was.w : 0, ms);
    put(el, keep ? 0 : was.dir * was.w, ms);
    later(() => (keep || btn(-was.dir).click(), done()), ms); // not far enough: back to what was there
  };
  let seen = false;
  try {
    seen = !!localStorage.getItem('venn:swiped');
  } catch {}
  if (!hinted && !seen && touchFirst() && btn(1) && !btn(1).disabled) {
    hinted = true;
    nudge = setTimeout(() => el.isConnected && el.classList.add('swipe-hint'), 700);
    el.addEventListener('animationend', () => el.classList.remove('swipe-hint'), { once: true });
  }
}

const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * A month calendar.
 * - Toggle mode (`selected` + `onChange`): tap or drag to pick several days.
 * - Open mode (`onDay`): tap a day to open it; `active()` is the open day.
 * `marks(date)` returns a short note shown under the day number (and read out with it).
 * `dayClass(date)` adds classes to a day, for ranges such as the days a trip covers.
 * `views` ['month', 'week'] adds a Month / Week switch: a week shows bigger days, a week at a time.
 */
export function monthView(
  root,
  {
    selected,
    onChange,
    onDay,
    active = () => null,
    marks = () => '',
    dayClass = () => '',
    views = null,
    onView = () => {},
    drag: canDrag = true,
  },
) {
  const today = todayStr();
  const toggle = !!selected;
  // The first page starts at this week, to the month's end (next month's, if under two weeks are left).
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const span = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() < 14 ? 2 : 1;
  const monthsFrom = (c) => (c.getFullYear() - thisMonth.getFullYear()) * 12 + c.getMonth() - thisMonth.getMonth();
  let cursor = thisMonth;
  let view = views?.[0] || 'month';
  const weekOf = (d) => addDays(d, -((dateParts(d).getUTCDay() + 6) % 7));
  let weekStart = weekOf(today); // the Monday of the week shown, in week view
  root.innerHTML = `
    ${
      views
        ? `<div class="seg cal-views" role="radiogroup" aria-label="Calendar view">${views
            .map((v) => `<button type="button" role="radio" data-cal-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`)
            .join('')}</div>`
        : ''
    }
    <div class="cal-head">
      <button type="button" class="icon-btn" data-nav="-1" aria-label="Previous month">‹</button>
      <h3 class="cal-month" aria-live="polite"></h3>
      <button type="button" class="icon-btn" data-nav="1" aria-label="Next month">›</button>
    </div>
    <div class="cal-grid" role="group" aria-label="Dates"></div>`;
  const grid = $('.cal-grid', root);

  function render() {
    const week = view === 'week';
    for (const b of $$('[data-cal-view]', root)) b.setAttribute('aria-checked', b.dataset.calView === view);
    grid.classList.toggle('cal-week', week);
    if (monthsFrom(cursor) < span) cursor = thisMonth;
    const y = cursor.getFullYear(),
      m = cursor.getMonth();
    const first = !week && monthsFrom(cursor) === 0;
    const end = new Date(y, m + (first ? span : 1), 0);
    const days = week
      ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
      : first
        ? Array.from({ length: Math.round((end - new Date(`${weekOf(today)}T00:00`)) / 864e5) + 1 }, (_, i) =>
            addDays(weekOf(today), i),
          )
        : Array.from({ length: end.getDate() }, (_, i) => ymd(y, m, i + 1));
    $('.cal-month', root).textContent = week
      ? `${fmtMonthDay.format(dateParts(days[0]))} – ${fmtMonthDay.format(dateParts(days[6]))}`
      : first && span > 1
        ? `${fmtMonth.format(dateParts(ymd(y, m, 1)))}${y !== end.getFullYear() ? ` ${y}` : ''} – ${fmtMonth.format(dateParts(ymd(end.getFullYear(), end.getMonth(), 1)))} ${end.getFullYear()}`
        : cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    $('[data-nav="-1"]', root).setAttribute('aria-label', week ? 'Previous week' : 'Previous month');
    $('[data-nav="1"]', root).setAttribute('aria-label', week ? 'Next week' : 'Next month');
    let h = Array.from(
      { length: 7 },
      (_, i) => `<span class="cal-dow" aria-hidden="true">${fmtDow.format(new Date(Date.UTC(2023, 0, 2 + i)))}</span>`,
    ).join('');
    if (!week && !first) h += '<span></span>'.repeat((new Date(y, m, 1).getDay() + 6) % 7); // weeks start on Monday
    for (const ds of days) {
      const d = +ds.slice(8);
      const mark = marks(ds);
      const state = toggle ? `aria-pressed="${selected.has(ds)}"` : ds === active() ? 'aria-current="date"' : '';
      const off = ds < today;
      // The number is the visible name; the weekday, month and note are read out with it.
      const dt = dateParts(ds);
      const mo = first && d === 1 && ds !== days[0] && !mark ? `${esc(fmtMonth.format(dt))} ` : '';
      h += `<button type="button" class="cal-day${ds === today ? ' today' : ''}${mark ? ' marked' : ''}${mo ? ' cal-1st' : ''} ${dayClass(ds)}" data-date="${ds}" ${state}${off ? ' disabled' : ''}><span class="sr-only">${esc(fmtDow.format(dt))} </span>${mo}${d}<span class="sr-only"> ${esc(fmtMonth.format(dt))}${mark ? `, ${esc(mark)}` : ''}</span>${mark ? `<small aria-hidden="true">${esc(mark)}</small>` : ''}</button>`;
    }
    grid.innerHTML = h;
    $('[data-nav="-1"]', root).disabled = week ? weekStart <= today : first;
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
    if (!toggle || !canDrag || !btn || btn.disabled || e.pointerType !== 'mouse') return;
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
    if (canDrag && pointer === 'mouse' && e.detail) return; // a mouse click was the drag; Enter or Space (detail 0) still toggles
    pointer = null;
    drag = selected.has(btn.dataset.date) ? 'remove' : 'add';
    apply(btn);
    drag = null;
    onChange();
  });
  root.addEventListener('click', (e) => {
    const v = e.target.closest('[data-cal-view]');
    if (v) {
      // The week view opens on the first week of the month shown (or this week), and back.
      if (v.dataset.calView === 'week' && view === 'month') {
        const first = ymd(cursor.getFullYear(), cursor.getMonth(), 1);
        weekStart = weekOf(first < today ? today : first);
      } else if (v.dataset.calView === 'month' && view === 'week') {
        const d = weekStart < today ? today : weekStart;
        cursor = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, 1);
      }
      view = v.dataset.calView;
      onView(view);
      return render();
    }
    const nav = e.target.closest('[data-nav]');
    if (!nav) return;
    if (view === 'week') weekStart = addDays(weekStart, 7 * +nav.dataset.nav);
    else {
      const k = monthsFrom(cursor) + +nav.dataset.nav;
      cursor = new Date(
        thisMonth.getFullYear(),
        thisMonth.getMonth() + (k <= 0 ? 0 : k < span ? (+nav.dataset.nav > 0 ? span : 0) : k),
        1,
      );
    }
    render();
  });
  swipe(grid, root, (n) => `[data-nav="${n}"]`);
  render();
  return {
    render,
    show(date) {
      cursor = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, 1);
      weekStart = weekOf(date < today ? today : date);
      render();
    },
    /** 'month' or 'week'. */
    setView(v) {
      if (views?.includes(v)) view = v;
      render();
    },
    cleanup: () => window.removeEventListener('pointerup', end),
  };
}

/** The same day `n` months on, or the month's last day. */
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

const h23 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle === 'h23';
/** "7p", "7:30p", or "19" on a 24-hour clock: for a phone's narrow week. */
export function tinyTime(m) {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60 ? `:${String(m % 60).padStart(2, '0')}` : '';
  return h23 ? `${h}${mm}` : `${h % 12 || 12}${mm}${h < 12 ? 'a' : 'p'}`;
}
