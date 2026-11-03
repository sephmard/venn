// A week or a day of 30-minute rows: organizers draw on it; guests see options by busy times.
// Apart from picker.js (the month), so the create pages load it only when a poll has times.

import { addDays } from './core.js';
import { HOLD, STEP, addMonths, swipe, tinyTime, touchFirst } from './picker.js';
import {
  $,
  $$,
  buzz,
  dateParts,
  dayChip,
  dayHead,
  dayLabel,
  esc,
  fmtMonthDay,
  isPhone,
  shortRange,
  shortTime,
  todayStr,
} from './ui.js';

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
