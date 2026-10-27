// "Ask when people are available" (/new/free): you pick a range of days, everyone marks when
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
import { monthView, timeView } from './picker.js';
import {
  $,
  $$,
  app,
  dateParts,
  dayLabel,
  esc,
  fmtDay,
  lengthLabel,
  plural,
  shortRange,
  shortTime,
  todayStr,
  track,
} from './ui.js';

import {
  brush,
  brushBox,
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
  ifNeededTip,
  fromUrl,
} from './create.js';

// ---------- "Ask when people are available" ----------

const HOUR_LENGTHS = [30, 60, 90, 120, 180, 240];
// How detailed guests' answers are, from the broadest to the finest.
const LEVELS = [
  // Short, so all three fit on one line on a phone.
  ['days', 'Days'],
  ['parts', 'Parts of day'],
  ['hours', 'Hours'],
];
// Parts of the day and hours: the painter, and what the page does with what's painted. Most
// whole-day polls never load it.
let pt = null;
const loadPaint = async () => (pt ??= await import('./paint.js'));

export function renderFree() {
  document.title = 'Ask when people are available · Venn';
  const src = source();
  if (!src?.edit) track('view', { page: 'free', ...(fromUrl() && { from: fromUrl() }) });
  startForm();
  // What's picked at each level. Zooming in or out carries it to the next level.
  const selected = new Set(); // days, for whole days
  const partsSel = new Set(); // "YYYY-MM-DD|<part start>", for parts of the day
  const painted = new Set(); // "YYYY-MM-DD|minutes", for hours
  // What's only "if needed" for the organizer, at each level; the rest of what's picked works for them.
  const maybe = { days: new Set(), parts: new Set(), hours: new Set() };
  const st = { days: selected, parts: partsSel, hours: painted, maybe, defaultParts: new Set(DAY_PARTS.map((p) => p.key)) };
  let before = new Set(); // what the level had at the last update, to see what's new
  let level = 'days';
  let length = 120; // minutes, for hours
  let painter = null;
  let cal = null;
  let mounts = 0; // the painter loads on demand: only the latest level shows when it arrives

  app.innerHTML = `
    <form id="create" class="create" novalidate>
      <a class="back" href="/new" data-link>‹ Both kinds of poll</a>
      <h1>Ask when people are available</h1>
      ${planFields('free')}
      <section class="sheet" aria-labelledby="when-h">
        <h2 id="when-h">When could it be?</h2>
        <div class="zoom">
          <span class="scope-label" id="level-l">Guests answer with</span>
          <div class="seg" role="radiogroup" aria-labelledby="level-l">
            ${LEVELS.map(([k, l]) => `<button type="button" role="radio" data-level="${k}">${l}</button>`).join('')}
          </div>
        </div>
        <div class="inline-field inline-row" data-for="days">
          <label for="span">Days in a row</label>
          <div class="stepper">
            <button type="button" class="icon-btn" data-step="-1" aria-label="One day fewer">−</button>
            <input id="span" type="number" min="1" max="${MAX_SPAN_DAYS}" value="1" inputmode="numeric">
            <button type="button" class="icon-btn" data-step="1" aria-label="One day more">+</button>
          </div>
        </div>
        <div class="inline-field" data-for="hours">
          <h3 class="sub-h" id="len-h">How long is it?</h3>
          <div class="pills" role="group" aria-labelledby="len-h">
            ${HOUR_LENGTHS.map((m) => `<button type="button" class="pill" data-flength="${m}" aria-pressed="false">${lengthLabel(m)}</button>`).join('')}
          </div>
        </div>
        <p class="hint" id="when-help" hidden></p>
        ${TAP_KEY}
        <div id="when"></div>
        <div class="pills quick" role="group" aria-label="Quick picks" id="quick"></div>
        ${tzLine()}
        ${brushBox()}
      </section>
      <section class="sheet poll-preview" aria-labelledby="preview-h">
        <h2 id="preview-h">Guests choose from</h2>
        <div id="free-list" class="opt-list" aria-live="polite"></div>
      </section>
      ${youFields()}
      ${createBar('Create poll')}
    </form>`;

  const occasion = wirePlan((o) => {
    if (!o) return;
    if (o.days) {
      $('#span').value = o.days;
      return setLevel('days');
    }
    if (typeof o.length === 'number') setLength(o.length);
    // Days picked from now on get the plan's usual part of the day.
    if (o.part) st.defaultParts = new Set([o.part]);
    update();
  });

  const span = () => Math.max(1, Math.min(MAX_SPAN_DAYS, +$('#span').value || 1));
  // Where to go when Create is pressed with nothing picked: the calendar.
  const gridFocus = () => $('#when .pg-cell[tabindex="0"]') || $('#when .tg-scroll') || $('#when .cal-day:not(:disabled)');

  /** Zoom between whole days, parts of the day and hours. */
  async function setLevel(next) {
    if (next === level && (painter || cal)) return;
    if (!pt && (next !== 'days' || (level && level !== 'days'))) await loadPaint();
    pt?.zoom(st, level, next);
    before = new Set(st[next]);
    level = next;
    for (const b of $$('[data-level]')) b.setAttribute('aria-checked', b.dataset.level === level);
    for (const el of $$('[data-for]')) el.hidden = el.dataset.for !== level;
    mount();
    update();
  }
  function setLength(v) {
    length = v;
    for (const b of $$('[data-flength]')) b.setAttribute('aria-pressed', +b.dataset.flength === v);
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
  /** Days in a row read as one band: joined to the day before (l) and after (r) on the same line of
   * the calendar, or carrying on over a line or month break (cl, cr). If needed days are amber. */
  function band(d) {
    if (!selected.has(d)) return '';
    const [prev, next, wd] = [addDays(d, -1), addDays(d, 1), weekdayOf(d)];
    const month = (x) => x.slice(0, 7) === d.slice(0, 7);
    return [
      maybe.days.has(d) && 'day-maybe',
      selected.has(prev) && (wd && month(prev) ? 'run-l' : 'run-cl'),
      selected.has(next) && (wd < 6 && month(next) ? 'run-r' : 'run-cr'),
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
    root.innerHTML = $('#quick').innerHTML = '';
    $('#when-help').hidden = false;
    const clear = '<button type="button" class="pill pill-quiet" id="q-clear">Clear all</button>';
    if (level === 'days') {
      const said = (d) => (selected.has(d) ? (maybe.days.has(d) ? 'If needed' : 'Available') : '');
      cal = monthView(root, { selected, onChange: tapped, dayClass: band, marks: said });
      const first = [...selected].sort()[0];
      if (first) cal.show(first);
      $('#quick').innerHTML = `
        <button type="button" class="pill" id="q-2w">Next 2 weeks</button>
        <button type="button" class="pill" id="q-weekends">Next 4 weekends</button>${clear}`;
      return;
    }
    const parts = level === 'parts';
    const set = st[level];
    // Parts of the day and hours need the painter, which most whole-day polls never load.
    const { paintView, datesOf, paintHelp, fillPills } = await loadPaint();
    if (at !== mounts || !root.isConnected) return;
    // Hours are times on the week calendar, moved and stretched with block-edit.js, loaded then too.
    if (!parts) {
      const { editBlocks } = await import('./block-edit.js');
      if (at !== mounts || !root.isConnected) return;
      return mountHours(root, datesOf(set)[0], fillPills, editBlocks);
    }
    painter = paintView(root, {
      selected: set,
      onChange: update,
      startAt: datesOf(set)[0],
      parts: parts && DAY_PARTS,
      maybe: maybe[level],
      marking: () => brush() === IF_NEEDED,
    });
    $('#when-help').textContent = paintHelp();
    $('#quick').innerHTML = fillPills(parts) + clear;
  }

  /**
   * Hours: the same week / day calendar as "vote on a few dates". Drag (or tap) to add a stretch of
   * time, drag it or its edges to move or change it, tap it to switch between available and if
   * needed, or × to remove it. What's picked stays as half hours, so the levels still carry over.
   */
  function mountHours(root, first, fillPills, editBlocks) {
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
    let shown = [];
    const view = timeView(root, {
      label: 'Calendar',
      views: ['week', 'day'],
      range: () => [420, 1440],
      tapLength: () => length,
      startAt: () => null,
      blocks: () =>
        pt.windowsAt(st, 'hours').map((w) => ({
          key: keyOf(w),
          date: w.date,
          from: w.start,
          to: w.end,
          cls: w.maybe ? 'opt opt-maybe' : 'opt',
          label: shortRange(w.start, w.end),
          short: shortTime(w.start),
          tiny: shortTime(w.start),
          tag: w.maybe ? 'If needed' : 'Available',
          title: `${shortRange(w.start, w.end)} ${w.maybe ? 'If needed' : 'Available'}, ${dayLabel(w.date)}. Tap to make it ${w.maybe ? 'available' : 'if needed'}`,
          remove: `Remove ${shortRange(w.start, w.end)}, ${dayLabel(w.date)}`,
        })),
      onCreate: (date, from, to) => {
        put(date, from, to, brush() === IF_NEEDED);
        changed();
      },
      onBlock: (k) => {
        const w = find(k);
        if (w) put(w.date, w.start, w.end, !w.maybe);
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
      onRender: (ds) => (shown = ds),
    });
    if (first) view.show(first);
    // The quick fills paint the seven days of the week shown, starting today at the earliest.
    const week = () => {
      const sun = addDays(shown[0], -dateParts(shown[0]).getUTCDay());
      const from = sun < todayStr() ? todayStr() : sun;
      return Array.from({ length: 7 }, (_, i) => addDays(from, i));
    };
    painter = { render: view.render, week, cleanup: view.cleanup };
    $('#when-help').textContent = 'Drag on the calendar to add times.';
    $('#quick').innerHTML = fillPills(false) + '<button type="button" class="pill pill-quiet" id="q-clear">Clear all</button>';
  }

  const fill = (n, keep) => {
    selected.clear();
    for (let d = todayStr(), i = 0; selected.size < n && i < 120; d = addDays(d, 1), i++)
      if (keep(dateParts(d).getUTCDay())) selected.add(d);
    // Show the month that got most of the days picked.
    const months = new Map();
    for (const d of selected) months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) || 0) + 1);
    const [best] = [...months].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || [todayStr().slice(0, 7)];
    update(); // first, so the calendar shows which are if needed
    cal.show(`${best}-01`);
  };
  /** After the picks change from outside the calendars: show them there too. */
  const redraw = () => {
    update();
    painter?.render();
    cal?.render();
  };
  $('#create').addEventListener('click', (e) => {
    const lv = e.target.closest('[data-level]');
    if (lv) setLevel(lv.dataset.level);
    const l = e.target.closest('[data-flength]');
    if (l) {
      setLength(+l.dataset.flength);
      update();
    }
    const s = e.target.closest('[data-step]');
    if (s) {
      $('#span').value = Math.max(1, Math.min(MAX_SPAN_DAYS, span() + +s.dataset.step));
      update();
    }
    const f = e.target.closest('[data-fill]');
    if (f) {
      pt.fillWeek(st[level], level === 'parts', +f.dataset.fill, painter.week());
      redraw();
    }
    if (e.target.closest('#q-2w')) fill(14, () => true);
    if (e.target.closest('#q-weekends')) fill(12, (wd) => wd === 5 || wd === 6 || wd === 0);
    if (e.target.closest('#q-clear')) {
      painted.clear();
      partsSel.clear();
      selected.clear();
      redraw();
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
            ? `<span class="od-len${ok ? '' : ' short'}">${plural(run.length, 'day')}${k > 1 ? (ok ? ' · long enough' : ` · too short`) : ''}</span>`
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
    if ([...st[level]].some((k) => !before.has(k))) ifNeededTip();
    for (const l in maybe) for (const k of [...maybe[l]]) if (!st[l].has(k)) maybe[l].delete(k);
    before = new Set(st[level]);
    const box = $('#free-list');
    if (level === 'hours') {
      const windows = pt.toWindows(painted);
      const dates = pt.datesOf(painted);
      box.innerHTML = windows.length
        ? pt.windowList(pt.windowsAt(st, level), level, chip, dayRange)
        : '<p class="hint">Nothing yet.</p>';
      return setReady(
        `${plural(dates.length, 'day')} to choose from`,
        [!windows.length, 'Add at least one time to create the poll', gridFocus, null, 'times'],
        [
          windows.length && !windows.some((w) => w.end - w.start >= length),
          `Your times are shorter than ${lengthLabel(length)}. Make one longer`,
          gridFocus,
          null,
          'longer times',
        ],
        ...nameAndEmail(),
      );
    }
    if (level === 'parts') {
      const windows = pt.windowsAt(st, level);
      box.innerHTML = windows.length ? pt.windowList(windows, level, chip, dayRange) : '<p class="hint">Nothing yet.</p>';
      return setReady(
        `${plural(windows.length, 'time')} to choose from`,
        [!windows.length, 'Pick at least one morning, afternoon or evening', gridFocus, null, 'times'],
        ...nameAndEmail(),
      );
    }
    const dates = [...selected].sort();
    const k = span();
    // The tap key above the calendar says the rest.
    $('#when-help').hidden = k < 2;
    $('#when-help').textContent = `Tap a day to pick ${k} in a row from it.`;
    box.innerHTML = dates.length ? runList(dates, k) : '<p class="hint">Nothing yet.</p>';
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
    // The organizer's own answer: what they picked, available or if needed.
    const answer = hostAnswer(st[level], maybe[level], tz);
    if (level === 'hours')
      return submit({ windows: pt.toWindows(painted), slotMinutes: 30, durationMinutes: length }, occasion, answer);
    if (level === 'parts') {
      const options = pt
        .windowsAt(st, level)
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
      $('#span').value = ev.durationMinutes / 1440;
      for (const d of ev.dates) selected.add(d);
    } else {
      next = 'hours';
      setLength(ev.durationMinutes);
      const ranges = ev.windows || ev.dates.map((date) => ({ date, start: ev.startMinute, end: ev.endMinute }));
      for (const w of ranges) for (let m = w.start - (w.start % 30); m < w.end; m += 30) painted.add(`${w.date}|${m}`);
    }
    // What the organizer answered: the times that are only if needed for them.
    const mine = ev.participants?.find((p) => p.id === ev.hostId)?.availability || {};
    for (const k of st[next]) if (mine[keySlot(k, ev.timezone)] === IF_NEEDED) maybe[next].add(k);
    level = null; // show the level again, from the poll's days or times
    setLevel(next);
  }

  setLength(120);
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
