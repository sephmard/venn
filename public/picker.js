// Calendar views shared by organizers and guests.
//   monthView  a month of days: pick several (tap or drag), or open one day at a time
//   timeView   a week or a day of 30-minute rows: organizers draw on it; guests see options by busy times

import { addDays } from './core.js';
import {
  $,
  $$,
  buzz,
  dateParts,
  dayChip,
  dayHead,
  dayLabel,
  esc,
  fmtDow,
  fmtMonth,
  fmtMonthDay,
  isPhone,
  shortRange,
  shortTime,
  todayStr,
} from './ui.js';

export { dayChip, isPhone };

const STEP = 30;
const HOLD = 300; // ms a finger rests before it draws or moves instead of scrolling
/** Phones, and touch screens up to a tablet's width: the calendars open on one day. */
const touchFirst = () => matchMedia('(max-width: 640px), (pointer: coarse) and (max-width: 1024px)').matches;

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
      const mo = first && d === 1 && ds !== days[0] ? `${esc(fmtMonth.format(dt))} ` : '';
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

/**
 * A grid of 30-minute rows for one or more days, with blocks drawn on it.
 *   dates()    the columns (YYYY-MM-DD)
 *   range()    [from, to] minutes after midnight shown
 *   blocks()   [{ key, date, from, to, cls, label, short, tiny, tag, title }] positioned in local minutes;
 *              `short` replaces `label` when blocks share the width, and `tiny` ("7p") is used in a
 *              phone's narrow week columns
 *   busy()     [{ date, from, to }] shown behind the blocks
 *   onCreate(date, from, to)  drag (mouse) or tap (touch, keyboard-free) on an empty spot; omit for read-only
 *   onBlock(key)              tap a block
 *   editBlocks, onResize(key, from, to), onMove(key, date, from, to)  dragging blocks (block-edit.js)
 *   tapLength()               minutes for a tap
 *   tapSnap()                 a tap starts on this many minutes (60: the hour tapped, as the labels
 *                             read); drags and edges still move in half hours
 *   startAt()                 minutes to open at when the days shown have no blocks (null: 5 PM)
 * Returns { render, home() (scroll back to the start), cleanup }.
 */
function timeGrid(
  root,
  {
    dates,
    range,
    blocks,
    busy = () => [],
    onCreate,
    onBlock,
    onResize,
    onMove,
    editBlocks,
    tapLength = () => 60,
    tapSnap = () => STEP,
    startAt = () => null,
  },
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
    // A phone's week has narrow columns: "7p" fits where "7 – 9 PM" breaks into "9 / P / M", "Mon 2" where "Mon Nov 2" won't.
    const narrow = ds.length > 1 && isPhone();
    const head = ds
      .map(
        (d) =>
          `<button type="button" class="tg-day day-head${d === todayStr() ? ' today' : d < todayStr() ? ' past' : ''}" data-open-day="${d}">${dayHead(d)}<span class="sr-only">${d < todayStr() ? ', past' : ''}: show it on its own</span></button>`,
      )
      .join('');
    let times = '';
    for (let m = from; m < to; m += 60)
      times += `<span style="top:calc(${at(m)} * var(--row))">${esc(narrow ? tinyTime(m) : shortTime(m))}</span>`;
    const pos = (a, b) =>
      `top:calc(${at(Math.max(a, from))} * var(--row));height:calc(${(Math.min(b, to) - Math.max(a, from)) / STEP} * var(--row))`;
    const all = blocks();
    const text = (b, n) => (narrow && b.tiny != null ? b.tiny : n > 1 && b.short ? b.short : b.label);
    // Its name starts with what it shows ("7p"), so it can be said to be tapped by what's on it.
    const named = (b, n) => {
      const full = b.title || b.label;
      return full.startsWith(text(b, n)) ? full : `${text(b, n)}: ${full}`;
    };
    const today = todayStr();
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
            (
              b,
              i,
              _,
              style = `${pos(b.from, b.to)};left:calc(3px + (100% - 6px) * ${lane[i]} / ${n});width:calc((100% - 6px) / ${n} - 2px)`,
            ) =>
              `<button type="button" class="tg-block ${b.cls || ''}${b.to - b.from < 60 ? ' tg-short' : ''}" data-key="${esc(b.key)}" style="${style}" aria-label="${esc(named(b, n))}">${editor?.top || ''}<span>${esc(text(b, n))}</span>${b.tag ? ` <small>${esc(b.tag)}</small>` : ''}${editor?.bottom || ''}</button>${editor ? editor.after(b, style) : ''}`,
          )
          .join('');
        // Organizers can't add options on days that have gone by.
        const draw = onCreate && d >= today;
        return `<div class="tg-col${draw ? ' tg-draw' : onCreate ? ' tg-past' : ''}" data-date="${d}">${bz}${bl}</div>`;
      })
      .join('');
    root.innerHTML = `
      <div class="tg${narrow ? ' tg-narrow' : ''}" style="--cols:${ds.length};--rows:${rows}">
        ${ds.length > 1 ? `<div class="tg-head"><span></span>${head}</div>` : ''}
        <div class="tg-scroll" tabindex="0" role="region" aria-label="Calendar times">
          <div class="tg-body"><div class="tg-times" aria-hidden="true">${times}</div>${cols}</div>
        </div>
      </div>`;
    const sc = $('.tg-scroll', root);
    if (scrollTop != null) sc.scrollTop = scrollTop;
    else {
      // Start at the first block, or where the plan usually happens (the early evening by default).
      const first = all.filter((b) => ds.includes(b.date)).sort((a, b) => a.from - b.from)[0];
      sc.scrollTop = Math.max(0, at(first ? first.from - 60 : (startAt() ?? 1020))) * rowPx(root);
    }
  }

  const rowPx = (el) => parseFloat(getComputedStyle($('.tg', el) || el).getPropertyValue('--row')) || 24;
  const minuteAt = (col, y) => {
    const [from, to] = range();
    const r = Math.floor((y - col.getBoundingClientRect().top) / rowPx(root));
    return Math.min(to - STEP, Math.max(from, from + r * STEP));
  };

  // A tap's start, on the hour (or half hour) it lands in, never before the first time shown.
  const snap = (m) => Math.max(range()[0], m - (m % tapSnap()));

  const editor = editBlocks?.(root, { blocks, range, minuteAt, rowPx, onResize, onMove });

  // Mouse: drag to draw. Touch: a tap drops a block; hold, then drag, to draw (a swipe scrolls).
  let drag = null;
  let pointer = null;
  let hold = null; // a touch waiting to become a drag
  let tapped = false; // a touch drag just ended: the click after it isn't a tap
  const begin = (col, y) => {
    const a = minuteAt(col, y);
    const ghost = document.createElement('span');
    ghost.className = 'tg-block tg-ghost';
    col.append(ghost);
    drag = { col, a, b: a, ghost, moved: false };
    root.classList.add('tg-dragging'); // the calendar shows it's drawing, not scrolling
    paintGhost();
  };
  let down = null; // where the finger really was: a browser steers taps near a time onto it
  root.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]), true);
  root.addEventListener('pointerdown', (e) => {
    pointer = e.pointerType;
    if (editor?.active()) return;
    const col = e.target.closest('.tg-draw');
    if (!onCreate || !col || e.target.closest('.tg-block') || e.button > 0) return;
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      return begin(col, e.clientY);
    }
    const { clientX: x, clientY: y } = e;
    clearTimeout(hold?.timer);
    hold = { x, y, timer: setTimeout(() => ((hold = null), begin(col, y), buzz()), HOLD) };
  });
  // While a touch draws, the page mustn't scroll; before the hold, a move is a scroll.
  const touchMove = (e) => {
    if (drag) return e.cancelable && e.preventDefault();
    const t = e.touches[0];
    if (hold && Math.hypot(t.clientX - hold.x, t.clientY - hold.y) > 8) {
      clearTimeout(hold.timer);
      hold = null;
    }
  };
  root.addEventListener('touchmove', touchMove, { passive: false });
  root.addEventListener('pointercancel', () => {
    clearTimeout(hold?.timer);
    hold = null;
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
    clearTimeout(hold?.timer);
    hold = null;
    if (!drag) return;
    const { col, a, b, moved } = drag;
    drag = null;
    root.classList.remove('tg-dragging');
    // The click straight after a touch drag isn't a tap (and there may be no click at all).
    tapped = pointer !== 'mouse';
    setTimeout(() => (tapped = false), 400);
    const lo = moved ? Math.min(a, b) : snap(a);
    onCreate(col.dataset.date, lo, moved ? Math.max(a, b) + STEP : Math.min(lo + tapLength(), 1440));
  };
  window.addEventListener('pointerup', up);
  root.addEventListener('click', (e) => {
    if (editor?.takeClick() || tapped) return void (tapped = false);
    const touch = e.detail && pointer !== 'mouse' && down;
    const at = touch ? document.elementFromPoint(...down) : e.target;
    const block = at?.closest('.tg-block[data-key]');
    if (block) return onBlock?.(block.dataset.key);
    const col = at?.closest('.tg-draw');
    if (!onCreate || !col || pointer === 'mouse') return;
    const a = snap(minuteAt(col, touch ? down[1] : e.clientY));
    onCreate(col.dataset.date, a, Math.min(a + tapLength(), 1440));
  });
  return {
    render,
    home() {
      shownDates = '';
      render();
    },
    cleanup() {
      window.removeEventListener('pointerup', up);
      editor?.cleanup();
    },
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

/**
 * Week and Day views with navigation.
 *   days       fixed list of days to page through (guests), or null to roam freely from today (organizers)
 *   marks(d)   short note for a day in the day strip ("2", "Eve")
 *   onRender(dates)  after each render, with the days shown
 *   strip(day) organizers: the days in the day view's strip (day-nav.js), else the week of `day`
 * Plus the timeGrid options. Organizers (no `days`) page a week at a time in both views: the week
 * runs Monday to Sunday, and the day view's strip picks the day.
 */
export function timeView(root, opts) {
  const { days = null, marks = () => '', label = 'Calendar', views = ['week', 'day'] } = opts;
  let view = touchFirst() && views.includes('day') ? 'day' : views[0];
  let anchor = days ? 0 : todayStr(); // index into days, or a date

  root.innerHTML = `
    <div class="tv-bar">
      <div class="seg tv-views" role="radiogroup" aria-label="${esc(label)} view"${views.length > 1 ? '' : ' hidden'}>
        ${views.map((v) => `<button type="button" role="radio" data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}
      </div>
      <div class="tv-nav">
        ${days ? '' : '<button type="button" class="icon-btn" data-month="-1" aria-label="Back a month">«</button>'}
        <button type="button" class="icon-btn" data-step="-1" aria-label="Earlier">‹</button>
        <span class="tv-label" aria-live="polite"></span>
        <button type="button" class="icon-btn" data-step="1" aria-label="Later">›</button>
        ${days ? '' : '<button type="button" class="icon-btn" data-month="1" aria-label="Forward a month">»</button>'}
      </div>
    </div>
    <div class="tv-strip" role="group" aria-label="Days"></div>
    <div class="tv-grid"></div>`;
  const strip = $('.tv-strip', root);

  const weekOf = (d) => addDays(d, -((dateParts(d).getUTCDay() + 6) % 7));
  const shown = () => {
    if (days) return view === 'week' ? days.slice(anchor, anchor + 7) : [days[anchor]];
    if (view === 'day') return [anchor];
    return Array.from({ length: 7 }, (_, i) => addDays(weekOf(anchor), i));
  };
  const grid = timeGrid($('.tv-grid', root), { ...opts, dates: shown });
  swipe($('.tv-grid', root), root, (n) => `.tv-nav [data-step="${n}"]`);

  function render() {
    for (const b of $$('[data-view]', root)) b.setAttribute('aria-checked', b.dataset.view === view);
    const ds = shown();
    $('.tv-label', root).textContent =
      ds.length > 1 ? `${fmtMonthDay.format(dateParts(ds[0]))} – ${fmtMonthDay.format(dateParts(ds.at(-1)))}` : dayLabel(ds[0]);
    const first = days ? anchor === 0 : weekOf(anchor) <= todayStr();
    $('[data-step="-1"]', root).disabled = first;
    if ($('[data-month="-1"]', root)) $('[data-month="-1"]', root).disabled = first;
    if (!days) {
      $('[data-step="-1"]', root).setAttribute('aria-label', 'Previous week');
      $('[data-step="1"]', root).setAttribute('aria-label', 'Next week');
    }
    $('[data-step="1"]', root).disabled = days ? anchor + (view === 'week' ? 7 : 1) >= days.length : false;
    // On the day view, a strip of nearby days to jump between.
    strip.hidden = view !== 'day';
    if (view === 'day') {
      const near = days || opts.strip?.(anchor) || Array.from({ length: 7 }, (_, i) => addDays(weekOf(anchor), i));
      strip.innerHTML = near
        .map((d) => {
          const m = marks(d);
          return `<button type="button" class="tv-chip" data-day="${d}" aria-pressed="${d === ds[0]}"${!days && d < todayStr() ? ' disabled' : ''}>${dayChip(d, m)}</button>`;
        })
        .join('');
    }
    grid.render();
    opts.onRender?.(ds);
  }

  root.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]');
    if (v && root.contains(v)) {
      view = v.dataset.view;
      return render();
    }
    // « » a month (never before today)
    const mo = e.target.closest('.tv-nav [data-month]');
    if (mo) {
      anchor = addMonths(anchor, +mo.dataset.month);
      if (anchor < todayStr()) anchor = todayStr();
      return render();
    }
    const st = e.target.closest('.tv-nav [data-step]');
    if (st) {
      const n = (view === 'week' || !days ? 7 : 1) * +st.dataset.step;
      anchor = days ? Math.max(0, Math.min(days.length - 1, anchor + n)) : addDays(anchor, n);
      if (!days && anchor < todayStr()) anchor = todayStr();
      return render();
    }
    // A day's name at the top of the week opens that day.
    const open = e.target.closest('[data-open-day]');
    if (open && views.includes('day')) {
      view = 'day';
      anchor = days ? days.indexOf(open.dataset.openDay) : open.dataset.openDay;
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
    /** Show a given day (organizers jumping to one). */
    show(date) {
      anchor = days ? Math.max(0, days.indexOf(date)) : date < todayStr() ? todayStr() : date;
      render();
    },
    /** Scroll the times back to where they start (after the kind of plan changes, say). */
    home: () => grid.home(),
    cleanup: () => grid.cleanup(),
  };
}
