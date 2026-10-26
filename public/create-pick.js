// "Vote on a few dates" (/new/pick): you suggest some dates or times, and everyone votes on each.
// Loaded only on that page; the shared form parts are in create.js.

import { DAY_PARTS, IF_NEEDED, MINUTE, MAX_SPAN_DAYS, YES, addDays, lengthChip, utcToZoned, zonedToUtc } from './core.js';
import { editBlocks } from './block-edit.js';
import { isPhone, monthView, timeView } from './picker.js';
import { $, $$, app, dayLabel, esc, getConfig, lengthLabel, plural, shortRange, shortTime, todayStr } from './ui.js';

import {
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
} from './create.js';

// ---------- "Vote on a few dates" ----------

// How long an option is: minutes (30 min, 1 hour, or any other length), 'half' for a morning,
// afternoon or evening, 'allday', or 'days' for a trip.
const LENGTHS = [
  [30, '30 min'],
  [60, '1 hour'],
  ['half', 'Half day'],
  ['allday', 'All day'],
  ['days', 'Several days'],
  ['custom', 'Other'],
];
// The lengths "Other" offers: 15-minute steps up to 4 hours, then half hours up to 12.
const OTHER_LENGTHS = Array.from({ length: 32 }, (_, i) => (i < 16 ? 15 + i * 15 : 270 + (i - 16) * 30));
const otherOptions = (v) =>
  [...new Set([...OTHER_LENGTHS, v])]
    .sort((a, b) => a - b)
    .map((m) => `<option value="${m}"${m === v ? ' selected' : ''}>${lengthLabel(m)}</option>`)
    .join('');
const timeRange = shortRange;
// Where the calendar opens for a kind of plan, by its usual part of the day.
const PART_OPENS = { morning: 480, afternoon: 720, evening: 1020 };
const h23 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle === 'h23';
/** A start time that fits a phone's narrow week column: "7p", "7:30p", or "19" with a 24-hour clock. */
function tinyTime(m) {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60 ? `:${String(m % 60).padStart(2, '0')}` : '';
  return h23 ? `${h}${mm}` : `${h % 12 || 12}${mm}${h < 12 ? 'a' : 'p'}`;
}

export function renderPick() {
  document.title = 'Vote on a few dates · Venn';
  const src = source();
  startForm();
  // The options so far, in local time: { date, from, to } in minutes, or { date, days } for all day or longer.
  const items = new Map();
  let length = 120;
  let spanDays = 3;
  let brush = YES; // new options are marked as working for the organizer, or only if needed
  let view = null; // the week / day picker, for options with times
  let month = null; // the month, for all-day options and trips
  let lastFrom = null; // the start of the option added or moved last, where other days open
  let half = null; // the mornings, afternoons and evenings, for half-day options
  let mounts = 0; // the half-day picker loads on demand: only the latest calendar shows when it arrives
  let nav = null; // more ways around the calendar (day-nav.js), loaded after the page
  let shown = []; // the days the calendar shows

  app.innerHTML = `
    <form id="create" class="create" novalidate>
      <a class="back" href="/new" data-link>‹ Both kinds of poll</a>
      <h1>Vote on a few dates</h1>
      ${planFields('pick')}
      <section class="sheet" aria-labelledby="length-h">
        <h2 id="length-h">How long is it?</h2>
        <div class="pills" role="group" aria-labelledby="length-h">
          ${LENGTHS.map(([v, l]) => `<button type="button" class="pill" data-length="${v}" aria-pressed="false">${l}</button>`).join('')}
        </div>
        <div class="inline-field" id="span-field" hidden>
          <label for="span">How many days is the trip?</label>
          <div class="stepper">
            <button type="button" class="icon-btn" data-step="-1" aria-label="One day fewer">−</button>
            <input id="span" type="number" min="2" max="${MAX_SPAN_DAYS}" value="3" inputmode="numeric">
            <button type="button" class="icon-btn" data-step="1" aria-label="One day more">+</button>
          </div>
        </div>
        <div class="inline-field" id="custom-field" hidden>
          <label for="custom">Length</label>
          <select id="custom">${otherOptions(90)}</select>
        </div>
      </section>
      <section class="sheet" aria-labelledby="when-h">
        <h2 id="when-h">When could it be?</h2>
        <div class="pick-brush">
          <span class="scope-label" id="brush-l">For you, new options are</span>
          <div class="seg brush" role="radiogroup" aria-labelledby="brush-l">
            <button type="button" role="radio" data-pbrush="${YES}"><span class="swatch swatch-yes"></span>Available</button>
            <button type="button" role="radio" data-pbrush="${IF_NEEDED}"><span class="swatch swatch-maybe"></span>If needed</button>
          </div>
        </div>
        <p class="hint" id="when-hint"></p>
        <div id="picker"></div>
        <div class="add-time" id="add-time" role="group" aria-labelledby="at-l" hidden></div>
        ${tzLine()}
      </section>
      <section class="sheet poll-preview" aria-labelledby="preview-h">
        <h2 id="preview-h">Options in your poll</h2>
        <div id="options-list" class="opt-list" aria-live="polite"></div>
      </section>
      ${youFields()}
      ${createBar('Create poll')}
    </form>`;

  const occasion = wirePlan((o) => {
    if (!o) return;
    if (o.days) {
      spanDays = o.days;
      $('#span').value = spanDays;
    }
    setLength(o.length);
    view?.home(); // open at the plan's usual time: a morning for coffee, an evening for dinner
    if (lastFrom == null && PART_OPENS[o.part] && $('#at-time')) $('#at-time').value = PART_OPENS[o.part];
  });

  // Options with times of their own (any length in minutes), parts of the day, or whole days.
  const kindOf = (v) => (typeof v === 'number' ? 'time' : v === 'half' ? 'half' : 'day');
  const timed = () => kindOf(length) === 'time';
  // Where to go when Create is pressed with no options: the calendar.
  const calendarFocus = () =>
    $('#at-day:not([disabled])') || $('#picker .pg-cell[tabindex="0"]') || $('#picker .cal-day:not(:disabled)');
  const minutes = () => length;
  const onDate = (d) => [...items.values()].filter((it) => it.date === d);
  const mark = (d) => (onDate(d).length ? String(onDate(d).length) : '');
  const ifNeeded = (it) => it.v === IF_NEEDED;
  const tripDays = (it) => it.days || spanDays;

  // ----- adding and removing options -----
  function add(it) {
    lastFrom = it.from;
    items.set(`${it.date}|${it.from}`, { ...it, v: brush }); // one option per start time
    changed();
  }
  /** Tapping an option switches it between available and if needed (for the organizer). */
  function flip(k) {
    const it = items.get(k);
    it.v = ifNeeded(it) ? YES : IF_NEEDED;
    changed();
  }
  /** An option dragged to a new length, time or day. */
  function reshape(k, date, from, to) {
    const it = items.get(k);
    lastFrom = from;
    items.delete(k);
    items.set(`${date}|${from}`, { ...it, date, from, to });
    changed();
  }
  function remove(k) {
    items.delete(k);
    changed();
  }

  function changed() {
    view?.render();
    month?.render();
    half?.render();
    renderList();
  }

  // ----- the pickers -----
  function mountPicker() {
    view?.cleanup();
    nav?.cleanup();
    nav = null;
    month?.cleanup();
    half?.cleanup();
    view = month = half = null;
    mounts++;
    const root = $('#picker');
    $('#add-time').hidden = !timed();
    if (length === 'half') return mountHalf(root);
    if (timed()) {
      buildAddTime();
      $('#when-hint').textContent = isPhone()
        ? 'Tap the calendar to add an option of the length above. Drag its top or bottom edge to change the length. Tap an option to switch between available and if needed, or × to remove it.'
        : 'Drag on the calendar to add an option, or click to add one of the length above. Drag an edge to change the length, or drag it to another time. Click an option to switch between available and if needed, or × to remove it.';
      view = timeView(root, {
        label: 'Calendar',
        views: ['week', 'day'],
        range: () => [420, 1440],
        tapLength: minutes,
        startAt: () => lastFrom ?? PART_OPENS[occasion()?.part] ?? null,
        blocks: () =>
          [...items.entries()]
            .filter(([, it]) => it.from != null)
            .map(([k, it]) => ({
              key: k,
              date: it.date,
              from: it.from,
              to: Math.min(it.to, 1440),
              cls: ifNeeded(it) ? 'opt opt-maybe' : 'opt',
              label: `${ifNeeded(it) ? '~ ' : ''}${timeRange(it.from, it.to)}`,
              short: shortTime(it.from),
              tiny: tinyTime(it.from), // amber, and named "if needed", when it is: no room for "~"
              title: `${timeRange(it.from, it.to)}, ${dayLabel(it.date)}, ${ifNeeded(it) ? 'if needed' : 'available'} for you. Tap to make it ${ifNeeded(it) ? 'available' : 'if needed'}`,
              remove: `Remove ${timeRange(it.from, it.to)}, ${dayLabel(it.date)}`,
            })),
        onCreate: (date, from, to) => add({ date, from, to }),
        onBlock: flip,
        onResize: (k, from, to) => reshape(k, items.get(k).date, from, to),
        onMove: reshape,
        editBlocks: (el, o) => editBlocks(el, { ...o, onRemove: remove }),
        marks: mark,
        strip: (d) => nav?.strip(d),
        onRender: (ds) => (showAddDays((shown = ds)), nav?.update(ds)),
      });
      const v = view;
      import('./day-nav.js').then(({ dayNav }) => {
        if (view !== v) return; // the calendar changed meanwhile
        nav = dayNav(root, v, mark);
        // The day view's strip gets its months ahead; a week only needs « set.
        if (shown.length === 1) v.render();
        else nav.update(shown);
      });
    } else {
      $('#when-hint').textContent =
        length === 'days'
          ? 'Tap the first day of each trip you could take. The highlighted days show how long each one lasts. Tap an option below to switch between available and if needed.'
          : 'Tap each day you want to suggest. Tap an option below to switch between available and if needed.';
      const starts = new Set([...items.values()].filter((it) => it.from == null).map((it) => it.date));
      const covered = (d) =>
        length === 'days' &&
        [...items.values()].some((it) => it.from == null && d > it.date && d < addDays(it.date, tripDays(it)));
      month = monthView(root, {
        selected: starts,
        dayClass: (d) => `${covered(d) ? 'in-trip' : ''}${items.get(`${d}|day`)?.v === IF_NEEDED ? ' day-maybe' : ''}`,
        onChange: () => {
          for (const [k, it] of items) if (it.from == null && !starts.has(it.date)) items.delete(k);
          for (const d of starts)
            if (!items.has(`${d}|day`)) items.set(`${d}|day`, { date: d, days: length === 'days' ? spanDays : 1, v: brush });
          month.render();
          renderList();
        },
      });
    }
  }

  // ----- half days: a morning, an afternoon or an evening, on a week of days -----
  // The "parts of the day" picker from the other create page, loaded when it's first needed.
  async function mountHalf(root) {
    const at = mounts;
    root.innerHTML = '';
    $('#when-hint').textContent =
      `${isPhone() ? 'Tap a day, then' : 'Click'} the mornings, afternoons and evenings you could do, or drag across several. Tap an option below to switch between available and if needed.`;
    const { halfView } = await import('./half-day.js');
    if (at !== mounts || !root.isConnected) return;
    half = halfView(root, { items, brush: () => brush, onChange: renderList, startAt: sorted()[0]?.[1].date });
  }

  // ----- adding a time without a pointer: a day, a start time and Add -----
  function buildAddTime() {
    const at = lastFrom ?? PART_OPENS[occasion()?.part] ?? 1080;
    const times = [];
    for (let m = 420; m < 1440; m += 30)
      times.push(`<option value="${m}"${m === at ? ' selected' : ''}>${esc(shortTime(m))}</option>`);
    $('#add-time').innerHTML = `
      <span class="scope-label" id="at-l">Or add a time</span>
      <div class="add-time-row">
        <div><label for="at-day">Day</label><input id="at-day" type="date" min="${todayStr()}"></div>
        <div><label for="at-time">Starts at</label><select id="at-time">${times.join('')}</select></div>
        <button type="button" class="btn" id="at-add">Add</button>
      </div>`;
    // Any day from today on; the calendar goes to the day picked.
    const day = () => ($('#at-day').value >= todayStr() ? $('#at-day').value : '');
    $('#at-day').onchange = () => day() && view.show(day());
    $('#at-add').onclick = () => {
      const date = day();
      const from = +$('#at-time').value;
      if (!date) return $('#at-day').focus();
      view.show(date);
      add({ date, from, to: Math.min(from + minutes(), 1440) }); // the same as a tap
    };
  }
  /** The day follows the calendar: the day it shows, or the first one to come in the week shown. */
  function showAddDays(ds) {
    const el = $('#at-day');
    if (el && !ds.includes(el.value)) el.value = ds.find((d) => d >= todayStr()) || todayStr();
  }

  // ----- the options in the poll, by day -----
  const partOfItem = (it) => length === 'half' && DAY_PARTS.find((p) => p.start === it.from && p.end === it.to);
  const itemLabel = (it) =>
    it.from != null
      ? `${partOfItem(it) ? `${partOfItem(it).label} ` : ''}${timeRange(it.from, it.to)}`
      : length === 'days'
        ? `${dayLabel(it.date)} – ${dayLabel(addDays(it.date, tripDays(it) - 1))}`
        : 'All day';
  const sorted = () =>
    [...items.entries()].sort(([, a], [, b]) => a.date.localeCompare(b.date) || (a.from ?? -1) - (b.from ?? -1));
  function renderList() {
    const list = sorted();
    const box = $('#options-list');
    updateReady();
    if (!list.length) {
      box.innerHTML = `<p class="hint">Nothing yet. ${timed() ? 'Add times on the calendar above.' : length === 'half' ? 'Pick mornings, afternoons or evenings above.' : 'Tap days on the calendar above.'} Everyone will say yes, if needed or no to each option you add.</p>`;
      return;
    }
    const removeBtn = (k, label) => `<button type="button" data-remove="${esc(k)}" aria-label="Remove ${esc(label)}">×</button>`;
    // The option's label switches it between available and if needed.
    const flipBtn = (k, it, label) =>
      `<button type="button" class="chip-flip" data-flip="${esc(k)}" aria-label="${esc(`${label}, ${ifNeeded(it) ? 'if needed' : 'available'} for you. Switch to ${ifNeeded(it) ? 'available' : 'if needed'}`)}">${esc(itemLabel(it))}${ifNeeded(it) ? ' <small class="chip-tag">If needed</small>' : ''}</button>`;
    let rows;
    if (length === 'days') {
      rows = list
        .map(
          ([k, it]) => `<li class="od-row">
            <span class="chip trip ${ifNeeded(it) ? 'maybe' : 'yes'}">${flipBtn(k, it, itemLabel(it))}${removeBtn(k, itemLabel(it))}</span>
            <span class="od-len">
              <button type="button" class="icon-btn" data-trip="${esc(k)}" data-d="-1" aria-label="One day shorter, ${esc(itemLabel(it))}"${tripDays(it) <= 2 ? ' disabled' : ''}>−</button>
              <span>${plural(tripDays(it), 'day')}</span>
              <button type="button" class="icon-btn" data-trip="${esc(k)}" data-d="1" aria-label="One day longer, ${esc(itemLabel(it))}"${tripDays(it) >= MAX_SPAN_DAYS ? ' disabled' : ''}>+</button>
            </span>
          </li>`,
        )
        .join('');
    } else {
      const days = new Map();
      for (const [k, it] of list) {
        if (!days.has(it.date)) days.set(it.date, []);
        days.get(it.date).push([k, it]);
      }
      rows = [...days]
        .map(
          ([d, its]) => `<li class="od-row">
            <span class="od-date">${esc(dayLabel(d))}</span>
            <span class="chips">${its
              .map(
                ([k, it]) =>
                  `<span class="chip ${ifNeeded(it) ? 'maybe' : 'yes'}">${flipBtn(k, it, `${dayLabel(d)}, ${itemLabel(it)}`)}${removeBtn(k, `${dayLabel(d)}, ${itemLabel(it)}`)}</span>`,
              )
              .join('')}</span>
          </li>`,
        )
        .join('');
    }
    box.innerHTML = `<p class="preview-lede">Guests will choose from <b>${plural(list.length, 'option')}</b>. <span class="muted">Tap one to switch it between available and if needed for you.</span></p>
      <ul class="od-list">${rows}</ul>
      <button type="button" class="link-btn" id="clear-options">Remove all</button>`;
  }
  $('#options-list').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) remove(rm.dataset.remove);
    const fl = e.target.closest('[data-flip]');
    if (fl) {
      flip(fl.dataset.flip);
      $(`[data-flip="${fl.dataset.flip}"]`)?.focus();
    }
    const trip = e.target.closest('[data-trip]');
    if (trip) {
      const it = items.get(trip.dataset.trip);
      it.days = Math.max(2, Math.min(MAX_SPAN_DAYS, tripDays(it) + +trip.dataset.d));
      changed();
      $(`[data-trip="${trip.dataset.trip}"][data-d="${trip.dataset.d}"]`)?.focus();
    }
    if (e.target.closest('#clear-options') && confirm('Remove all the options?')) {
      items.clear();
      changed();
    }
    if (kindOf(length) === 'day' && (rm || e.target.closest('#clear-options'))) mountPicker();
  });

  const renderBrush = () => {
    for (const b of $$('[data-pbrush]')) b.setAttribute('aria-checked', +b.dataset.pbrush === brush);
  };
  $('#create').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pbrush]');
    if (!b) return;
    brush = +b.dataset.pbrush;
    renderBrush();
  });
  renderBrush();

  // ----- length -----
  /**
   * Change how long the options are: minutes, 'half', 'allday', 'days', or 'custom' for "Other" at
   * the length it shows. Returns false when the organizer chose to keep their options rather than switch.
   */
  function setLength(v, { ask = true } = {}) {
    if (v === 'custom') v = +$('#custom').value;
    const was = kindOf(length);
    // Options of different kinds don't mix: switching between them starts over, so ask.
    const clears = items.size && was !== kindOf(v);
    const name = LENGTHS.find(([x]) => x === lengthChip(v))?.[1].toLowerCase();
    if (
      clears &&
      ask &&
      !confirm(`Switching to ${name} removes the ${plural(items.size, 'option')} you've added. Switch anyway?`)
    ) {
      showLength();
      return false;
    }
    length = v;
    showLength();
    if (clears) items.clear();
    // A new length applies to the options already added.
    if (timed()) for (const it of items.values()) it.to = Math.min(it.from + minutes(), 1440);
    else if (length !== 'half') for (const it of items.values()) it.days = v === 'days' ? spanDays : 1;
    // Keep the calendar (and the week it shows) when only the number of hours changes.
    if (was !== kindOf(length) || kindOf(length) === 'day' || (!view && !month && !half)) mountPicker();
    else changed();
    renderList();
  }
  /** The chip for the length, and "Other" with its length when it's another number of minutes. */
  function showLength() {
    const chip = lengthChip(length);
    for (const b of $$('[data-length]')) b.setAttribute('aria-pressed', b.dataset.length === chip);
    const other = chip === 'custom';
    $('[data-length="custom"]').textContent = other ? `Other · ${lengthLabel(length)}` : 'Other';
    if (other) $('#custom').innerHTML = otherOptions(length);
    $('#span-field').hidden = length !== 'days';
    $('#custom-field').hidden = !other;
  }
  $('#create').addEventListener('click', (e) => {
    const b = e.target.closest('[data-length]');
    if (b) setLength(Number.isNaN(+b.dataset.length) ? b.dataset.length : +b.dataset.length);
    const st = e.target.closest('#span-field [data-step]');
    if (st) {
      $('#span').value = Math.max(2, Math.min(MAX_SPAN_DAYS, (+$('#span').value || 3) + +st.dataset.step));
      setSpan();
    }
  });
  // The trip length applies to every trip, unless one was changed on its own.
  function setSpan() {
    spanDays = Math.max(2, Math.min(MAX_SPAN_DAYS, +$('#span').value || 2));
    for (const it of items.values()) if (it.from == null) it.days = spanDays;
    month?.render();
    renderList();
  }
  $('#span').oninput = setSpan;
  $('#span').onchange = () => {
    $('#span').value = spanDays;
  };
  $('#custom').onchange = () => setLength('custom');

  function options() {
    const tz = $('#tz').value;
    return sorted().map(([, it]) => {
      if (it.from == null)
        return {
          start: zonedToUtc(it.date, 0, tz),
          end: zonedToUtc(addDays(it.date, length === 'days' ? tripDays(it) : 1), 0, tz),
        };
      const start = zonedToUtc(it.date, it.from, tz);
      return { start, end: start + (it.to - it.from) * MINUTE };
    });
  }

  $('#create').onsubmit = (e) => {
    e.preventDefault();
    if (explainNotReady()) return;
    // The organizer's own answer, from how each option was marked.
    const answer = {};
    options().forEach((o, i) => (answer[o.start] = sorted()[i][1].v || YES));
    submit({ mode: 'options', options: options() }, occasion, answer);
  };

  function updateReady() {
    const n = items.size;
    setReady(
      `${plural(n, 'option')} to vote on`,
      [!n, 'Add at least one option to create the poll', calendarFocus],
      ...nameAndEmail(occasion),
    );
  }
  $('#title').addEventListener('input', updateReady);

  /**
   * Fill in these options ({ start, end }), with the length that fits them: all day, several days,
   * half days or a number of minutes. Each keeps the organizer's mark: available, or only if needed.
   */
  async function load(opts, tz, mark = () => YES) {
    const { length: len, days: n } = (await import('./lengths.js')).optionsLength(opts, tz);
    items.clear(); // they replace any already added
    if (len === 'days') $('#span').value = spanDays = n[0];
    setLength(len, { ask: false });
    opts.forEach((o, i) => {
      const { date, minutes: from } = utcToZoned(o.start, tz);
      const v = mark(o.start);
      if (n) items.set(`${date}|day`, { date, days: len === 'days' ? n[i] : 1, v });
      else items.set(`${date}|${from}`, { date, from, to: Math.min(from + (o.end - o.start) / MINUTE, 1440), v });
    });
    mountPicker();
    const first = sorted()[0]?.[1].date;
    if (first) (view || month)?.show(first);
    renderList();
  }

  /** Start from an existing poll's options. */
  async function prefill() {
    const ev = await loadSource(src);
    if (!ev || ev.mode !== 'options' || !$('#create')) return;
    fillCommon(ev, src);
    const host = ev.participants.find((p) => p.id === ev.hostId);
    load(ev.options, ev.timezone, (start) => (host?.availability[start] === IF_NEEDED ? IF_NEEDED : YES));
  }

  setLength(120);
  showConfig(updateReady);
  // Describing the plan in words, when this server has AI.
  getConfig().then((c) => c.ai && !src && import('./ai-draft.js').then((m) => $('#create') && m.aiDraft($('#create'), load)));
  if (src) prefill();
  else prefillTitle();
  $('#title').focus();
  return () => {
    mounts++;
    view?.cleanup();
    month?.cleanup();
    half?.cleanup();
  };
}
