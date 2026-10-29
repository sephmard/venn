// Creating a Venn (/new): you pick the days (and times) that could work, everyone marks when
// they're available, and Venn finds the overlap. Loaded only on that page.

import {
  DAY_PARTS,
  IF_NEEDED,
  LIMITS,
  MAX_SPAN_DAYS,
  addDays,
  dayRuns,
  hostAnswer,
  keySlot,
  longestRun,
  weekdayOf,
  utcToZoned,
  zonedToUtc,
} from './core.js';
import { monthView, timeView, tinyTime } from './picker.js';
import { $, $$, app, dateParts, dayLabel, esc, fmtDay, plural, shortTime, track } from './ui.js';

import {
  brush,
  createBar,
  explainNotReady,
  fillCommon,
  loadSource,
  nameAndEmail,
  planFields,
  prefillTitle,
  setReady,
  showConfig,
  source,
  startForm,
  submit,
  tzLine,
  wirePlan,
  youFields,
  TAP_KEY,
  fromUrl,
} from './create.js';

// ---------- "Ask when people are available" ----------

// Under what guests choose from, as on "vote on a few dates".
const CLEAR = '<button type="button" class="link-btn" id="q-clear">Clear all</button>';
const NOTHING = '<p class="hint">Nothing yet.</p>';
const UNDO = '<button type="button" class="link-btn" id="q-undo">Undo</button>';
// How detailed guests' answers are, one tap from whole days down to hours.
const LEVELS = [
  ['days', 'Days'],
  ['parts', 'Parts of day'],
  ['hours', 'Hours'],
];
// Parts of the day and hours: the painter, and what the page does with what's painted. Most
// whole-day polls never load it.
let pt = null;
const loadPaint = async () => (pt ??= await import('./paint.js'));

export function renderFree() {
  document.title = 'Create a Venn';
  const src = source();
  if (!src?.edit) track('view', { page: 'free', ...(fromUrl() && { from: fromUrl() }) });
  startForm();
  // What's picked at each level. Zooming in or out carries it to the next level.
  const selected = new Set(); // days, for whole days
  const partsSel = new Set(); // "YYYY-MM-DD|<part start>", for parts of the day
  const painted = new Set(); // "YYYY-MM-DD|minutes", for hours
  // What's only "if needed" for the organizer, at each level.
  const maybe = { days: new Set(), parts: new Set(), hours: new Set() };
  const st = { days: selected, parts: partsSel, hours: painted, maybe, defaultParts: new Set(DAY_PARTS.map((p) => p.key)) };
  let before = new Set(); // what the level had at the last update, to see what's new
  let level = 'days';
  let timeLevel = null; // the last of parts of the day or hours visited: where a day's own times are
  let cleared = null; // what Clear all took, until something new is picked
  let painter = null;
  let cal = null;
  let mounts = 0; // the painter loads on demand: only the latest level shows when it arrives

  app.innerHTML = `
    <form id="create" class="create" novalidate>
      <a class="back" href="/" hidden>‹ Back</a>
      <h1>Create a Venn</h1>
      <p class="lede create-lede">Tap the days that could work. Everyone marks when they're free, and Venn finds the overlap.</p>
      ${planFields('free')}
      <section class="sheet" aria-labelledby="when-h">
        <h2 id="when-h">When could it be?</h2>
        <div class="zoom">
          <div class="seg" role="radiogroup" aria-label="Guests answer with">
            ${LEVELS.map(([k, l]) => `<button type="button" role="radio" data-level="${k}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="inline-field inline-row optional" data-for="days">
          <label class="switch"><input type="checkbox" role="switch" id="in-row"> Days in a row <small class="opt-note">optional, for trips</small></label>
          <div class="stepper" id="span-box" hidden>
            <button type="button" class="icon-btn" data-step="-1" aria-label="One day fewer">−</button>
            <input id="span" type="number" min="2" max="${MAX_SPAN_DAYS}" value="2" inputmode="numeric" aria-label="Days in a row">
            <button type="button" class="icon-btn" data-step="1" aria-label="One day more">+</button>
          </div>
        </div>
        <p class="hint" id="when-help" hidden></p>
        ${TAP_KEY}
        <div id="when"></div>
        ${tzLine()}
      </section>
      <section class="sheet poll-preview" aria-labelledby="preview-h">
        <h2 id="preview-h">Guests choose from</h2>
        <div id="free-list" class="opt-list" aria-live="polite"></div>
      </section>
      ${youFields()}
      ${createBar('Create Venn')}
    </form>`;

  // A template shapes the calendar only while nothing is picked.
  const empty = () => !selected.size && !partsSel.size && !painted.size;
  const occasion = wirePlan((o) => {
    // Days picked from now on get the plan's usual part of the day.
    st.defaultParts = new Set(o?.part ? [o.part] : DAY_PARTS.map((p) => p.key));
    if (!empty()) return update();
    setRow(o?.days || 1);
    if (o?.days) return setLevel('days');
    update();
  });

  // Days in a row: off is single days; on, 2 or more, and the stepper shows.
  const span = () => ($('#in-row').checked ? Math.max(2, Math.min(MAX_SPAN_DAYS, +$('#span').value || 2)) : 1);
  function setRow(n) {
    $('#in-row').checked = n > 1;
    $('#span-box').hidden = n < 2;
    if (n > 1) $('#span').value = n;
  }
  // Where to go when Create is pressed with nothing picked: the calendar.
  const gridFocus = () => $('#when .pg-cell[tabindex="0"]') || $('#when .tg-scroll') || $('#when .cal-day:not(:disabled)');

  /** Zoom between whole days, parts of the day and hours. */
  async function setLevel(next) {
    if (next === level && (painter || cal)) return;
    if (!pt && (next !== 'days' || (level && level !== 'days'))) await loadPaint();
    pt?.zoom(st, level, next);
    before = new Set(st[next]);
    level = next;
    if (level !== 'days') timeLevel = level;
    for (const b of $$('[data-level]')) b.setAttribute('aria-checked', b.dataset.level === level);
    for (const el of $$('[data-for]')) el.hidden = el.dataset.for !== level;
    mount();
    update();
  }

  /** A tap (or click, Enter, Space, or a mouse drag) on the month calendar. With days in a row to
   * find, a tap on a day that isn't picked picks that many days from it; on a picked one, it takes
   * just that day away. */
  function tapped() {
    const added = [...selected].filter((d) => !before.has(d));
    const removed = [...before].filter((d) => !selected.has(d));
    // A tap on a picked day goes round: available, then if needed, then taken away.
    if (!added.length && removed.length === 1) {
      const [d] = removed;
      if (maybe.days.has(d)) maybe.days.delete(d);
      else {
        selected.add(d);
        maybe.days.add(d);
      }
    }
    if (added.length === 1)
      for (let i = 1, d = added[0]; i < span() && selected.size < LIMITS.dates; i++) selected.add((d = addDays(d, 1)));
    const focused = document.activeElement?.dataset?.date;
    update();
    cal.render();
    if (focused) $(`#when [data-date="${focused}"]`)?.focus();
  }
  /**
   * Picked days with times of their own, from the last of parts of the day or hours visited: less
   * than the whole day there. With any, the poll goes out at that level, and the other days whole,
   * so days and times mix in one poll.
   */
  function timed() {
    if (!pt || !timeLevel || span() > 1) return new Map();
    const ws = pt.windowsAt(st, timeLevel).filter((w) => selected.has(w.date));
    const whole = (d, own) =>
      timeLevel === 'hours'
        ? own.length === 1 && pt.hoursLabel(own[0].start, own[0].end) === 'All day'
        : DAY_PARTS.every((p) => partsSel.has(`${d}|${p.start}`));
    const out = new Map();
    for (const d of new Set(ws.map((w) => w.date))) {
      const own = ws.filter((w) => w.date === d);
      if (!whole(d, own)) out.set(d, own);
    }
    return out;
  }
  /** "6 – 9 PM", or "Evening": a time of a day that has its own. */
  const timeOf = (w) =>
    timeLevel === 'hours' ? pt.hoursLabel(w.start, w.end) : DAY_PARTS.find((p) => p.start === w.start)?.label;

  /** Days in a row read as one band: joined to the day before (l) and after (r) on the same line of
   * the calendar, or carrying on over a line or month break (cl, cr). If needed days are amber. */
  function band(d) {
    if (!selected.has(d)) return '';
    const [prev, next, wd] = [addDays(d, -1), addDays(d, 1), weekdayOf(d)];
    const month = (x) => x.slice(0, 7) === d.slice(0, 7);
    return [
      maybe.days.has(d) && 'day-maybe',
      selected.has(prev) && (wd !== 1 && month(prev) ? 'run-l' : 'run-cl'), // weeks run Monday to Sunday
      selected.has(next) && (wd !== 0 && month(next) ? 'run-r' : 'run-cr'),
    ]
      .filter(Boolean)
      .join(' ');
  }

  async function mount() {
    painter?.cleanup();
    cal?.cleanup();
    painter = cal = null;
    const root = $('#when');
    const at = ++mounts;
    root.innerHTML = '';
    $('#when-help').hidden = true;
    if (level === 'days') {
      const said = (d) => (selected.has(d) ? (timed().has(d) ? 'Times' : maybe.days.has(d) ? 'If needed' : 'Available') : '');
      cal = monthView(root, {
        selected,
        onChange: tapped,
        dayClass: band,
        marks: said,
        drag: false, // only hours are dragged; days are tapped
      });
      const first = [...selected].sort()[0];
      if (first) cal.show(first);
      return;
    }
    const parts = level === 'parts';
    const set = st[level];
    // Parts of the day and hours need the painter, which most whole-day polls never load.
    const { paintView, datesOf } = await loadPaint();
    if (at !== mounts || !root.isConnected) return;
    // Hours: the week calendar, edited with block-edit.js (loaded then too).
    if (!parts) {
      const { editBlocks } = await import('./block-edit.js');
      if (at !== mounts || !root.isConnected) return;
      return mountHours(root, datesOf(set)[0], editBlocks);
    }
    painter = paintView(root, {
      selected: set,
      onChange: update,
      startAt: datesOf(set)[0],
      parts: parts && DAY_PARTS,
      maybe: maybe[level],
      marking: () => brush() === IF_NEEDED,
      views: ['week'],
      drag: false, // only hours are dragged; parts of the day are tapped // a week at a time, phones too: no Week / Day to choose
    });
  }

  /**
   * Hours: the same week / day calendar as "vote on a few dates". Drag (or tap) to add a stretch of
   * time, drag it or its edges to move or change it, tap it to switch between available and if
   * needed, or × to remove it. What's picked stays as half hours, so the levels still carry over.
   */
  function mountHours(root, first, editBlocks) {
    const slots = (from, to) => Array.from({ length: Math.max(0, (to - from) / 30) }, (_, i) => from + i * 30);
    const keyOf = (w) => `${w.date}|${w.start}|${w.end}`;
    const find = (k) => pt.windowsAt(st, 'hours').find((w) => keyOf(w) === k);
    const put = (date, from, to, ifNeeded) => {
      for (const m of slots(from, Math.min(to, 1440))) {
        painted.add(`${date}|${m}`);
        if (ifNeeded) maybe.hours.add(`${date}|${m}`);
        else maybe.hours.delete(`${date}|${m}`);
      }
    };
    const take = (w) => {
      for (const m of slots(w.start, w.end)) {
        painted.delete(`${w.date}|${m}`);
        maybe.hours.delete(`${w.date}|${m}`);
      }
    };
    const changed = () => {
      view.render();
      update();
    };
    const view = timeView(root, {
      label: 'Calendar',
      views: ['week'], // a week at a time, phones too: no Week / Day to choose
      range: () => [420, 1440],
      // A tap adds the half hour tapped; a drag (or press and hold, on touch) draws longer.
      tapLength: () => 30,
      tapSnap: () => 30,
      startAt: () => null,
      blocks: () =>
        pt.windowsAt(st, 'hours').map((w) => ({
          key: keyOf(w),
          date: w.date,
          from: w.start,
          to: w.end,
          cls: w.maybe ? 'opt opt-maybe' : 'opt',
          label: pt.hoursLabel(w.start, w.end),
          short: shortTime(w.start),
          tiny: pt.hoursLabel(w.start, w.end) === 'All day' ? 'All day' : tinyTime(w.start),
          tag: w.maybe ? 'If needed' : 'Available',
          title: `${pt.hoursLabel(w.start, w.end)} ${w.maybe ? 'If needed' : 'Available'}, ${dayLabel(w.date)}. Tap to ${w.maybe ? 'remove it' : 'make it if needed'}`,
          remove: `Remove ${pt.hoursLabel(w.start, w.end)}, ${dayLabel(w.date)}`,
        })),
      onCreate: (date, from, to) => {
        put(date, from, to, brush() === IF_NEEDED);
        changed();
      },
      // A tap goes round: available, if needed, removed.
      onBlock: (k) => {
        const w = find(k);
        if (w?.maybe) take(w);
        else if (w) put(w.date, w.start, w.end, true);
        changed();
      },
      onResize: (k, from, to) => {
        const w = find(k);
        if (!w) return;
        take(w);
        put(w.date, from, to, w.maybe);
        changed();
      },
      onMove: (k, date, from, to) => {
        const w = find(k);
        if (!w) return;
        take(w);
        put(date, from, to, w.maybe);
        changed();
      },
      editBlocks: (el, o) =>
        editBlocks(el, {
          ...o,
          onRemove: (k) => {
            const w = find(k);
            if (w) take(w);
            changed();
          },
        }),
      marks: (d) => {
        const n = pt.windowsAt(st, 'hours').filter((w) => w.date === d).length;
        return n ? String(n) : '';
      },
    });
    if (first) view.show(first);
    painter = { render: view.render, cleanup: view.cleanup };
  }

  /** After the picks change from outside the calendars: show them there too. */
  const redraw = () => {
    update();
    painter?.render();
    cal?.render();
  };
  $('#create').addEventListener('click', (e) => {
    const lv = e.target.closest('[data-level]');
    if (lv) setLevel(lv.dataset.level);
    const s = e.target.closest('[data-step]');
    if (s) {
      $('#span').value = Math.max(2, Math.min(MAX_SPAN_DAYS, span() + +s.dataset.step));
      update();
    }
    // Clear all, and Undo in its place until something new is picked.
    if (e.target.closest('#q-clear')) {
      const copy = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, new Set(v)]));
      cleared = { picked: copy({ days: selected, parts: partsSel, hours: painted }), maybe: copy(maybe) };
      for (const l in maybe) {
        st[l].clear();
        maybe[l].clear();
      }
      before = new Set();
      redraw();
      $('#q-undo')?.focus();
    }
    if (e.target.closest('#q-undo') && cleared) {
      for (const l in maybe) {
        for (const k of cleared.picked[l]) st[l].add(k);
        for (const k of cleared.maybe[l]) maybe[l].add(k);
      }
      before = new Set(st[level]);
      cleared = null;
      redraw();
      $('#q-clear')?.focus();
    }
    // One × can stand for a whole week of evenings, or a run of days: ask first.
    const rm = e.target.closest('[data-rm-window]')?.dataset.rmWindow;
    if (rm) {
      if (rm.includes(',') && !confirm(`Remove ${pt.windowWhat(level, rm)}?`)) return;
      for (const k of pt.windowKeys(level, rm)) st[level].delete(k);
      redraw();
    }
    const rd = e.target.closest('[data-rm-days]')?.dataset.rmDays.split(',');
    if (rd) {
      if (rd.length > 1 && !confirm(`Remove these ${rd.length} days?`)) return;
      for (const d of rd) selected.delete(d);
      redraw();
    }
    // A day, or times, in the list switch between available and if needed for the organizer.
    const fl = e.target.closest('[data-flip-days], [data-flip-window]');
    if (fl) {
      const { flipDays: fd, flipWindow: fw } = fl.dataset;
      const keys = fd ? fd.split(',') : pt.windowKeys(level, fw);
      const may = maybe[level];
      const all = keys.every((k) => may.has(k));
      for (const k of keys) all ? may.delete(k) : may.add(k);
      redraw();
      ($(`#free-list [${fd ? `data-flip-days="${fd}"` : `data-flip-window="${fw}"`}]`) || $('#free-list .chip-flip'))?.focus();
    }
  });
  $('#in-row').onchange = () => {
    setRow($('#in-row').checked ? Math.max(2, +$('#span').value || 2) : 1);
    update();
  };
  $('#span').oninput = update;
  // Typing 0 or 99 counts as the nearest number that works; show it.
  $('#span').onchange = () => {
    $('#span').value = span();
    update();
  };
  $('#title').addEventListener('input', update);

  /** "Fri, Nov 6 – Sun, Nov 8" (or "Fri 6 – Sun 8 Nov", by language), or "Sat, Nov 7". */
  const dayRange = (dates) =>
    dates.length === 1 ? dayLabel(dates[0]) : fmtDay.formatRange(dateParts(dates[0]), dateParts(dates.at(-1)));
  /** A chip in the list: tap it to switch between available and if needed for you, × to remove it. */
  const chip = (flip, rm, text, label, m) =>
    `<span class="chip ${m ? 'maybe' : 'yes'}"><button type="button" class="chip-flip" ${flip} aria-label="${esc(`${label}, ${m ? 'if needed' : 'available'} for you. Switch to ${m ? 'available' : 'if needed'}`)}">${esc(text)}${m ? ' <small class="chip-tag">If needed</small>' : ''}</button><button type="button" ${rm} aria-label="Remove ${esc(label)}">×</button></span>`;

  /** Days in a row, each run as a range with its length: is it long enough for the days in a row
   * asked for? Inside a run, the days that are if needed for the organizer are a chip of their own. */
  const runList = (dates, k) =>
    `<ul class="od-list">${dayRuns(dates)
      .map((run) => {
        const parts = [];
        for (const d of run)
          if (parts.at(-1) && maybe.days.has(parts.at(-1)[0]) === maybe.days.has(d)) parts.at(-1).push(d);
          else parts.push([d]);
        const ok = run.length >= k;
        const len =
          run.length > 1 || k > 1
            ? `<span class="od-len${ok ? '' : ' short'}">${plural(run.length, 'day')}${k > 1 && !ok ? ' · too short' : ''}</span>`
            : '';
        return `<li class="od-row"><span class="chips">${parts
          .map((p) => {
            const at = `="${p.join(',')}"`;
            return chip(`data-flip-days${at}`, `data-rm-days${at}`, dayRange(p), dayRange(p), maybe.days.has(p[0]));
          })
          .join('')}</span>${len}</li>`;
      })
      .join('')}</ul>`;

  // What guests will be able to mark, and whether the poll can be created yet.
  function update() {
    // What's new takes the brush: available or if needed for the organizer.
    const may = maybe[level];
    for (const k of st[level]) if (!before.has(k)) brush() === IF_NEEDED ? may.add(k) : may.delete(k);
    if (st[level].size) cleared = null;
    for (const l in maybe) for (const k of [...maybe[l]]) if (!st[l].has(k)) maybe[l].delete(k);
    before = new Set(st[level]);
    const box = $('#free-list');
    if (level === 'hours') {
      const windows = pt.toWindows(painted);
      const dates = pt.datesOf(painted);
      box.innerHTML = windows.length
        ? pt.windowList(pt.windowsAt(st, level), level, chip, dayRange) + CLEAR
        : NOTHING + (cleared ? UNDO : '');
      return setReady(
        `${plural(dates.length, 'day')} to choose from`,
        [!windows.length, 'Pick at least one day to create the poll', gridFocus, null, 'days'],
        ...nameAndEmail(),
      );
    }
    if (level === 'parts') {
      const windows = pt.windowsAt(st, level);
      box.innerHTML = windows.length ? pt.windowList(windows, level, chip, dayRange) + CLEAR : NOTHING + (cleared ? UNDO : '');
      return setReady(
        `${plural(windows.length, 'time')} to choose from`,
        [!windows.length, 'Pick at least one day to create the poll', gridFocus, null, 'days'],
        ...nameAndEmail(),
      );
    }
    const dates = [...selected].sort();
    const k = span();
    // Days in a row are whole days: dates and times wait until it's back to one.
    for (const b of $$('[data-level]')) if (b.dataset.level !== 'days') b.disabled = k > 1;
    // The tap key above the calendar says the rest.
    $('#when-help').hidden = k < 2;
    $('#when-help').textContent = `Tap a day to pick ${k} in a row from it.`;
    // Days with times of their own keep them; the rest are whole days.
    const own = [...timed()].sort(([a], [b]) => a.localeCompare(b));
    const mixed = own.length
      ? `<p class="hint mix-note">${own
          .map(([d, ws]) => `<b>${esc(dayLabel(d))}</b>: ${esc(ws.map(timeOf).join(', '))}`)
          .join('<br>')}<br>The other days are all day.</p>`
      : '';
    box.innerHTML = dates.length ? runList(dates, k) + mixed + CLEAR : NOTHING + (cleared ? UNDO : '');
    setReady(
      `${plural(dates.length, 'day')} to choose from`,
      // Only the first that applies: no days, too few, or none in a row.
      [!dates.length, 'Pick at least one day to create the poll', gridFocus, null, 'days'],
      [dates.length && k > dates.length, `Pick at least ${k} days, for ${k} in a row`, gridFocus, null, `${k} days`],
      [
        k <= dates.length && longestRun(dates) < k,
        `None of your days make ${k} in a row. Pick days next to each other`,
        '#span',
        null,
        `${k} in a row`,
      ],
      ...nameAndEmail(),
    );
  }

  $('#create').onsubmit = (e) => {
    e.preventDefault();
    if (explainNotReady()) return;
    const tz = $('#tz').value;
    // Days, some with times of their own: the poll goes out at that level, the other days whole.
    let lv = level;
    if (lv === 'days' && timed().size) {
      pt.zoom(st, 'days', timeLevel);
      lv = timeLevel;
    }
    // The organizer's own answer: what they picked, available or if needed.
    const answer = hostAnswer(st[lv], maybe[lv], tz);
    if (lv === 'hours')
      return submit(
        // Any overlap counts: the times drawn say how long it could be.
        { windows: pt.toWindows(painted), slotMinutes: 30, durationMinutes: 30, anyLength: true },
        occasion,
        answer,
      );
    if (lv === 'parts') {
      const options = pt
        .windowsAt(st, lv)
        .map((w) => ({ start: zonedToUtc(w.date, w.start, tz), end: zonedToUtc(w.date, w.end, tz) }));
      return submit({ mode: 'options', layout: 'parts', options }, occasion, answer);
    }
    const dates = [...selected].sort();
    submit({ dates, startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: span() * 1440 }, occasion, answer);
  };

  /** Start from an existing poll's days, parts of the day or painted times. */
  async function prefill() {
    const ev = await loadSource(src);
    if (!ev || (ev.mode === 'options' && ev.layout !== 'parts') || !$('#create')) return;
    fillCommon(ev, src);
    painted.clear();
    partsSel.clear();
    selected.clear();
    let next = 'days';
    if (ev.layout === 'parts') {
      next = 'parts';
      for (const o of ev.options) {
        const z = utcToZoned(o.start, ev.timezone);
        if (DAY_PARTS.some((x) => x.start === z.minutes)) partsSel.add(`${z.date}|${z.minutes}`);
      }
    } else if (ev.slotMinutes === 1440) {
      setRow(ev.durationMinutes / 1440);
      for (const d of ev.dates) selected.add(d);
    } else {
      next = 'hours';
      const ranges = ev.windows || ev.dates.map((date) => ({ date, start: ev.startMinute, end: ev.endMinute }));
      for (const w of ranges) for (let m = w.start - (w.start % 30); m < w.end; m += 30) painted.add(`${w.date}|${m}`);
    }
    // What the organizer answered: the times that are only if needed for them.
    const mine = ev.participants?.find((p) => p.id === ev.hostId)?.availability || {};
    for (const k of st[next]) if (mine[keySlot(k, ev.timezone)] === IF_NEEDED) maybe[next].add(k);
    level = null; // show the level again, from the poll's days or times
    setLevel(next);
  }

  setLevel('days');
  // Fetch the painter as soon as the organizer heads for the levels, so zooming in doesn't wait.
  const warm = () => loadPaint().catch(() => {});
  for (const ev of ['pointerover', 'focusin']) $('.zoom').addEventListener(ev, warm, { once: true });
  showConfig(update);
  if (src) prefill();
  else prefillTitle();
  $('#title').focus();
  return () => {
    painter?.cleanup();
    cal?.cleanup();
  };
}
