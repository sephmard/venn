// The create pages: a chooser, then one of two quite different polls.
//   /new/pick  You suggest some dates (and times). Everyone votes on each one.
//   /new/free  You pick a range of days. Everyone marks when they're free; Venn finds the overlap.

import { MINUTE, MAX_SPAN_DAYS, addDays, utcToZoned, zonedToUtc } from './core.js';
import {
  $,
  $$,
  api,
  app,
  dateParts,
  dayLabel,
  esc,
  fmtDow,
  getConfig,
  lastName,
  lengthLabel,
  localTz,
  minutesLabel,
  plural,
  rememberName,
  save,
  toast,
  todayStr,
  tzName,
  tzOptions,
} from './ui.js';

// Kinds of plans, with sensible defaults. `length` is minutes, or 'days' for a trip.
const OCCASIONS = [
  { emoji: '🍝', label: 'Dinner', length: 120, times: [1080, 1110, 1140, 1170] },
  { emoji: '🍻', label: 'Drinks', length: 120, times: [1050, 1080, 1110, 1140] },
  { emoji: '📚', label: 'Book club', length: 120, times: [1110, 1140, 1170] },
  { emoji: '🥞', label: 'Brunch', length: 120, times: [600, 630, 660] },
  { emoji: '🎲', label: 'Game night', length: 180, times: [1110, 1140] },
  { emoji: '🥾', label: 'Hike', length: 240, times: [480, 540, 600] },
  { emoji: '🎉', label: 'Party', length: 240, times: [1140, 1200, 1260] },
  { emoji: '✈️', label: 'Trip', length: 'days', days: 3 },
];
const DEFAULT_TIMES = [600, 720, 900, 1080, 1140];

// The landing page's "What are you planning?" box sends its text as ?title=. The chooser passes
// it on, and the form puts it in the Name field.
const titleFromUrl = () => (new URLSearchParams(location.search).get('title') || '').trim().slice(0, 120);
function prefillTitle() {
  const title = titleFromUrl();
  if (!title) return;
  $('#title').value = title;
  history.replaceState(null, '', location.pathname);
}

// ---------- chooser ----------

export function renderChooser() {
  document.title = 'New poll · Venn';
  const carry = titleFromUrl() ? `?title=${encodeURIComponent(titleFromUrl())}` : '';
  app.innerHTML = `
    <section class="chooser">
      <h1>What kind of poll?</h1>
      <p class="lede">Two ways to find a date. Pick the one that fits your plans.</p>
      <div class="choices">
        <a class="choice" href="/new/pick${carry}" data-link>
          <span class="choice-art art-pick" aria-hidden="true"><i>Fri</i><i class="on">Sat</i><i>Sun</i></span>
          <span class="choice-title">Vote on a few dates</span>
          <span class="choice-text">You suggest some dates or times. Everyone says yes, if needed or no to each one.</span>
          <span class="choice-fit">Good for dinners, book clubs and parties</span>
        </a>
        <a class="choice" href="/new/free${carry}" data-link>
          <span class="choice-art art-free" aria-hidden="true"><i></i><i></i></span>
          <span class="choice-title">Ask when people are free</span>
          <span class="choice-text">You pick a range of days. Everyone marks when they're free, and Venn finds the overlap.</span>
          <span class="choice-fit">Good for trips, or when any day could work</span>
        </a>
      </div>
    </section>`;
}

// ---------- shared form parts ----------

function planFields(kind) {
  return `
    <section class="sheet" aria-labelledby="plan-h">
      <h2 id="plan-h">What's the plan?</h2>
      <div class="occasions" role="group" aria-label="Kind of plan">
        ${OCCASIONS.map((o, i) => `<button type="button" class="pill" data-occasion="${i}" aria-pressed="false"><span aria-hidden="true">${o.emoji}</span> ${esc(o.label)}</button>`).join('')}
      </div>
      <div class="title-row">
        <span class="emoji-tile" id="emoji-tile" aria-hidden="true">🗓️</span>
        <div class="grow">
          <label for="title">Name</label>
          <input id="title" type="text" maxlength="120" placeholder="${kind === 'free' ? 'Summer cabin trip' : "Dinner at Finn's"}" required>
        </div>
      </div>
      <div>
        <label for="location">Where <span class="muted">(optional)</span></label>
        <input id="location" type="text" maxlength="200" placeholder="A place, an address or a video link">
      </div>
      <details class="reveal" id="desc-box">
        <summary>Add a note for everyone</summary>
        <label for="desc" class="sr-only">Note</label>
        <textarea id="desc" maxlength="1000" placeholder="What to bring, who's cooking, the plan for the day"></textarea>
      </details>
    </section>`;
}

function youFields() {
  return `
    <section class="sheet" aria-labelledby="you-h">
      <h2 id="you-h">About you</h2>
      <div>
        <label for="organizer">Your name</label>
        <input id="organizer" type="text" maxlength="80" autocomplete="name" value="${esc(lastName())}" placeholder="So people know who's asking">
      </div>
      <div id="notify-field" hidden>
        <label for="notify">Email me when people answer <span class="muted">(optional)</span></label>
        <input id="notify" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com">
      </div>
      <details class="reveal">
        <summary>Time zone: <span id="tz-name">${esc(tzName(localTz))}</span></summary>
        <label for="tz">Time zone for the times you propose</label>
        <select id="tz">${tzOptions(localTz)}</select>
        <p class="hint">Everyone sees times in their own time zone.</p>
      </details>
    </section>`;
}

/** A month calendar for picking dates: tap, drag (mouse) or keyboard. */
function mountCalendar(root, selected, onChange) {
  const today = todayStr();
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
    const days = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const on = selected.has(ds);
      h += `<button type="button" class="cal-day${ds === today ? ' today' : ''}" data-date="${ds}" aria-pressed="${on}" aria-label="${esc(dayLabel(ds))}"${ds < today ? ' disabled' : ''}>${d}</button>`;
    }
    grid.innerHTML = h;
    $('[data-nav="-1"]', root).disabled = y === new Date().getFullYear() && m === new Date().getMonth();
  }

  let drag = null;
  let pointer = null;
  const apply = (btn) => {
    if (!btn || btn.disabled || !btn.dataset.date) return;
    if (drag === 'add') selected.add(btn.dataset.date);
    else selected.delete(btn.dataset.date);
    btn.setAttribute('aria-pressed', drag === 'add');
  };
  const toggle = (btn) => {
    drag = selected.has(btn.dataset.date) ? 'remove' : 'add';
    apply(btn);
    drag = null;
    onChange();
  };
  grid.addEventListener('pointerdown', (e) => {
    pointer = e.pointerType;
    const btn = e.target.closest('.cal-day');
    if (!btn || btn.disabled || e.pointerType !== 'mouse') return;
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
  // Touch and keyboard: a click fires for a tap (not a scroll) and for Enter/Space.
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.cal-day');
    if (!btn || btn.disabled || pointer === 'mouse') return;
    pointer = null;
    toggle(btn);
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

/** Wire up the plan fields: occasion presets fill in sensible defaults. */
function wirePlan(onOccasion) {
  let current = null;
  $('#create').addEventListener('click', (e) => {
    const b = e.target.closest('[data-occasion]');
    if (!b) return;
    const o = OCCASIONS[+b.dataset.occasion];
    current = current === o ? null : o;
    for (const x of $$('[data-occasion]')) x.setAttribute('aria-pressed', x === b && !!current);
    $('#emoji-tile').textContent = current?.emoji || '🗓️';
    if (current) $('#title').placeholder = current.label;
    onOccasion(current);
  });
  return () => current;
}

async function submit(body, occasion) {
  const err = $('#err');
  err.textContent = '';
  const title = $('#title').value.trim() || occasion()?.label || '';
  if (!title) {
    err.textContent = 'Give your plan a name.';
    $('#title').focus();
    return;
  }
  Object.assign(body, {
    title,
    location: $('#location').value.trim(),
    description: $('#desc').value.trim(),
    organizer: $('#organizer').value.trim(),
    timezone: $('#tz').value,
  });
  if (occasion()) body.emoji = occasion().emoji;
  const notifyEmail = $('#notify-field').hidden ? '' : $('#notify').value.trim();
  if (notifyEmail) body.notifyEmail = notifyEmail;
  if (body.organizer) rememberName(body.organizer);
  $('#submit').disabled = true;
  try {
    const { id, adminToken } = await api('events', { method: 'POST', body });
    save(id, { adminToken, justCreated: true, notifyPending: !!notifyEmail });
    history.pushState(null, '', `/e/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
    scrollTo(0, 0);
  } catch (ex) {
    err.textContent = ex.message;
    $('#submit').disabled = false;
  }
}

function showConfig() {
  getConfig().then((c) => {
    if ($('#notify-field')) $('#notify-field').hidden = !c.email;
  });
}

const createBar = (label) => `
  <div class="create-bar">
    <div class="create-sum">
      <span id="summary" aria-live="polite"></span>
      <span class="error" id="err" role="alert"></span>
    </div>
    <button class="btn btn-primary btn-lg" type="submit" id="submit">${esc(label)}</button>
  </div>`;

// ---------- "Vote on a few dates" ----------

const LENGTHS = [
  [60, '1 hour'],
  [120, '2 hours'],
  [180, '3 hours'],
  [240, '4 hours'],
  ['allday', 'All day'],
  ['days', 'A few days'],
  ['custom', 'Other'],
];

export function renderPick() {
  document.title = 'Vote on a few dates · Venn';
  const selected = new Set();
  const shared = new Set(); // times used on every date
  const perDate = new Map(); // date -> Set of times, when dates have different times
  let suggestions = [...DEFAULT_TIMES];
  let length = 120;
  let spanDays = 3;
  let same = true;

  app.innerHTML = `
    <form id="create" class="create" novalidate>
      <a class="back" href="/new" data-link>‹ Both kinds of poll</a>
      <h1>Vote on a few dates</h1>
      <div class="ai-draft sheet" id="ai-draft" hidden>
        <label for="ai-prompt">Describe it, and AI fills in the form</label>
        <div class="ai-row">
          <textarea id="ai-prompt" rows="2" maxlength="600" placeholder="Dinner for 6, any evening next week except Monday"></textarea>
          <button type="button" class="btn" id="ai-go">Fill it in</button>
        </div>
        <p class="hint">Your description is sent to Anthropic's Claude. Check everything before you create the poll.</p>
      </div>
      ${planFields('pick')}
      <section class="sheet" aria-labelledby="when-h">
        <h2 id="when-h">How long is it?</h2>
        <div class="pills" role="group" aria-label="How long">
          ${LENGTHS.map(([v, l]) => `<button type="button" class="pill" data-length="${v}" aria-pressed="false">${l}</button>`).join('')}
        </div>
        <div class="inline-field" id="span-field" hidden>
          <label for="span">How many days?</label>
          <div class="stepper">
            <button type="button" class="icon-btn" data-step="-1" aria-label="One day fewer">−</button>
            <input id="span" type="number" min="2" max="${MAX_SPAN_DAYS}" value="3" inputmode="numeric">
            <button type="button" class="icon-btn" data-step="1" aria-label="One day more">+</button>
          </div>
        </div>
        <div class="inline-field" id="custom-field" hidden>
          <label for="custom">Length in minutes</label>
          <input id="custom" type="number" min="15" max="1440" step="15" value="90" inputmode="numeric">
        </div>
      </section>
      <section class="sheet" aria-labelledby="dates-h">
        <h2 id="dates-h">Pick some dates</h2>
        <p class="hint" id="dates-hint">Tap each date you'd like to suggest.</p>
        <div id="cal"></div>
        <div class="pills quick" role="group" aria-label="Quick picks">
          <button type="button" class="pill" id="q-weekends">Weekends this month</button>
          <button type="button" class="pill" id="q-week">Next 7 days</button>
          <button type="button" class="pill pill-quiet" id="q-clear">Clear</button>
        </div>
      </section>
      <section class="sheet" aria-labelledby="times-h" id="times-sheet">
        <div class="sheet-head">
          <h2 id="times-h">What times?</h2>
          <label class="switch"><input type="checkbox" id="same" checked> Same times every day</label>
        </div>
        <div id="times"></div>
      </section>
      ${youFields()}
      ${createBar('Create poll')}
    </form>`;

  const cal = mountCalendar($('#cal'), selected, renderAll);
  const occasion = wirePlan((o) => {
    if (!o) return;
    setLength(o.length);
    if (o.days) {
      spanDays = o.days;
      $('#span').value = spanDays;
    }
    if (o.times) suggestions = [...new Set([...o.times, ...[...suggestions].filter((m) => shared.has(m))])].sort((a, b) => a - b);
    renderAll();
  });

  const timed = () => typeof length === 'number' || length === 'custom';
  const minutes = () => (length === 'custom' ? Math.max(15, Math.min(1440, +$('#custom').value || 60)) : length);

  function setLength(v) {
    length = v;
    for (const b of $$('[data-length]')) b.setAttribute('aria-pressed', b.dataset.length === String(v));
    $('#span-field').hidden = v !== 'days';
    $('#custom-field').hidden = v !== 'custom';
    renderAll();
  }
  $('#create').addEventListener('click', (e) => {
    const b = e.target.closest('[data-length]');
    if (b) setLength(Number.isNaN(+b.dataset.length) ? b.dataset.length : +b.dataset.length);
    const st = e.target.closest('[data-step]');
    if (st) {
      $('#span').value = Math.max(2, Math.min(MAX_SPAN_DAYS, (+$('#span').value || 3) + +st.dataset.step));
      spanDays = +$('#span').value;
      renderSummary();
    }
  });
  $('#span').oninput = () => {
    spanDays = Math.max(2, Math.min(MAX_SPAN_DAYS, +$('#span').value || 2));
    renderSummary();
  };
  $('#custom').oninput = renderSummary;

  const timesFor = (d) => (same ? shared : perDate.get(d) || new Set());
  const chipRow = (set, date = '') => `
    <div class="pills times" role="group" aria-label="${date ? `Times on ${esc(dayLabel(date))}` : 'Times'}">
      ${[...new Set([...suggestions, ...set])]
        .sort((a, b) => a - b)
        .map(
          (m) =>
            `<button type="button" class="pill" data-time="${m}" data-date="${date}" aria-pressed="${set.has(m)}">${esc(minutesLabel(m))}</button>`,
        )
        .join('')}
      <span class="other-time">
        <label class="sr-only" for="other-${date || 'all'}">Another time${date ? ` on ${esc(dayLabel(date))}` : ''}</label>
        <input type="time" step="900" id="other-${date || 'all'}" data-other="${date}">
        <button type="button" class="pill pill-quiet" data-add-other="${date}">Add</button>
      </span>
    </div>`;

  function renderTimes() {
    $('#times-sheet').hidden = !timed();
    if (!timed()) return;
    const dates = [...selected].sort();
    if (same || !dates.length) {
      $('#times').innerHTML =
        `<p class="hint">${dates.length ? 'Tap the times you want to suggest. They apply to every date.' : 'Pick dates first, then choose times.'}</p>${dates.length ? chipRow(shared) : ''}`;
      return;
    }
    $('#times').innerHTML = dates
      .map((d) => `<div class="date-times"><h3>${esc(dayLabel(d))}</h3>${chipRow(perDate.get(d) || new Set(), d)}</div>`)
      .join('');
  }
  $('#times').addEventListener('click', (e) => {
    const b = e.target.closest('[data-time]');
    const add = e.target.closest('[data-add-other]');
    if (b) {
      const d = b.dataset.date;
      const set = d ? perDate.get(d) || perDate.set(d, new Set()).get(d) : shared;
      const m = +b.dataset.time;
      if (set.has(m)) set.delete(m);
      else set.add(m);
      b.setAttribute('aria-pressed', set.has(m));
      renderSummary();
    } else if (add) {
      const d = add.dataset.addOther;
      const input = $(`[data-other="${d}"]`);
      if (!input.value) return input.focus();
      const [h, mm] = input.value.split(':').map(Number);
      const m = h * 60 + mm;
      if (!suggestions.includes(m)) suggestions.push(m);
      (d ? perDate.get(d) || perDate.set(d, new Set()).get(d) : shared).add(m);
      renderTimes();
      renderSummary();
    }
  });
  $('#same').onchange = (e) => {
    same = e.target.checked;
    if (!same) for (const d of selected) if (!perDate.has(d)) perDate.set(d, new Set(shared));
    renderTimes();
    renderSummary();
  };

  function options() {
    const tz = $('#tz').value;
    const out = [];
    for (const d of [...selected].sort()) {
      if (length === 'allday') out.push({ start: zonedToUtc(d, 0, tz), end: zonedToUtc(addDays(d, 1), 0, tz) });
      else if (length === 'days') out.push({ start: zonedToUtc(d, 0, tz), end: zonedToUtc(addDays(d, spanDays), 0, tz) });
      else
        for (const m of timesFor(d)) {
          const start = zonedToUtc(d, m, tz);
          out.push({ start, end: start + minutes() * MINUTE });
        }
    }
    return out;
  }

  function renderSummary() {
    const n = options().length;
    $('#summary').textContent = n ? `${plural(n, 'option')} to vote on` : '';
    $('#dates-hint').textContent =
      length === 'days'
        ? `Tap each date the trip could start. Each option lasts ${spanDays} days.`
        : "Tap each date you'd like to suggest.";
  }
  function renderAll() {
    renderTimes();
    renderSummary();
  }

  $('#q-weekends').onclick = () => {
    selected.clear();
    const t = todayStr();
    for (let d = t, i = 0; i < 31; d = addDays(d, 1), i++) {
      const wd = dateParts(d).getUTCDay();
      if ((wd === 0 || wd === 6) && d.slice(0, 7) === t.slice(0, 7)) selected.add(d);
    }
    if (!selected.size)
      for (let d = t, i = 0; i < 14; d = addDays(d, 1), i++) if ([0, 6].includes(dateParts(d).getUTCDay())) selected.add(d);
    cal.show(t);
    renderAll();
  };
  $('#q-week').onclick = () => {
    selected.clear();
    for (let d = todayStr(), i = 0; i < 7; d = addDays(d, 1), i++) selected.add(d);
    cal.show(todayStr());
    renderAll();
  };
  $('#q-clear').onclick = () => {
    selected.clear();
    cal.render();
    renderAll();
  };
  $('#tz').onchange = (e) => ($('#tz-name').textContent = tzName(e.target.value));

  $('#create').onsubmit = (e) => {
    e.preventDefault();
    const err = $('#err');
    if (!selected.size) return (err.textContent = 'Pick at least one date.');
    const opts = options();
    if (!opts.length) return (err.textContent = 'Choose at least one time.');
    submit({ mode: 'options', options: opts }, occasion);
  };

  // AI: describe the plan in words.
  $('#ai-go').onclick = async () => {
    const prompt = $('#ai-prompt').value.trim();
    if (!prompt) return $('#ai-prompt').focus();
    const btn = $('#ai-go');
    btn.disabled = true;
    btn.textContent = 'Filling in…';
    try {
      const tz = $('#tz').value;
      const draft = await api('ai/draft-poll', { method: 'POST', body: { prompt, timezone: tz } });
      if (!$('#title').value.trim()) $('#title').value = draft.title;
      if (!$('#desc').value.trim() && draft.description) {
        $('#desc').value = draft.description;
        $('#desc-box').open = true;
      }
      const preset = LENGTHS.find(([v]) => v === draft.durationMinutes);
      if (!preset) $('#custom').value = draft.durationMinutes;
      selected.clear();
      perDate.clear();
      for (const o of draft.options) {
        const z = utcToZoned(o.start, tz);
        selected.add(z.date);
        if (!perDate.has(z.date)) perDate.set(z.date, new Set());
        perDate.get(z.date).add(z.minutes);
        if (!suggestions.includes(z.minutes)) suggestions.push(z.minutes);
      }
      same = false;
      $('#same').checked = false;
      setLength(preset ? draft.durationMinutes : 'custom');
      cal.show([...selected].sort()[0]);
      $('#times-sheet').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(`Filled in ${plural(draft.options.length, 'option')}. Check them, then create the poll.`);
    } catch (ex) {
      toast(ex.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Fill it in';
    }
  };

  setLength(120);
  showConfig();
  getConfig().then((c) => $('#ai-draft') && ($('#ai-draft').hidden = !c.ai));
  prefillTitle();
  $('#title').focus();
  return cal.cleanup;
}

// ---------- "Ask when people are free" ----------

const WINDOWS = [
  ['day', 'Daytime', 540, 1020],
  ['evening', 'Evenings', 1020, 1380],
  ['all', 'Morning to night', 480, 1380],
  ['custom', 'Other hours', null, null],
];

export function renderFree() {
  document.title = 'Ask when people are free · Venn';
  const selected = new Set();
  let mark = 'days';

  const hourOptions = (sel) =>
    Array.from(
      { length: 25 },
      (_, h) =>
        `<option value="${h * 60}"${h * 60 === sel ? ' selected' : ''}>${minutesLabel((h * 60) % 1440)}${h === 24 ? ' (midnight)' : ''}</option>`,
    ).join('');

  app.innerHTML = `
    <form id="create" class="create" novalidate>
      <a class="back" href="/new" data-link>‹ Both kinds of poll</a>
      <h1>Ask when people are free</h1>
      ${planFields('free')}
      <section class="sheet" aria-labelledby="range-h">
        <h2 id="range-h">Which days could work?</h2>
        <p class="hint">Tap or drag across the days. People will mark the ones they're free.</p>
        <div id="cal"></div>
        <div class="pills quick" role="group" aria-label="Quick picks">
          <button type="button" class="pill" id="q-2w">Next 2 weeks</button>
          <button type="button" class="pill" id="q-weekends">Next 4 weekends</button>
          <button type="button" class="pill pill-quiet" id="q-clear">Clear</button>
        </div>
      </section>
      <section class="sheet" aria-labelledby="mark-h">
        <h2 id="mark-h">What should people mark?</h2>
        <div class="seg" role="radiogroup" aria-label="What people mark">
          <button type="button" role="radio" data-mark="days">Days they're free</button>
          <button type="button" role="radio" data-mark="hours">Hours they're free</button>
        </div>
        <div data-for="days" class="inline-field">
          <label for="span">How many days in a row do you need?</label>
          <div class="stepper">
            <button type="button" class="icon-btn" data-step="-1" aria-label="One day fewer">−</button>
            <input id="span" type="number" min="1" max="${MAX_SPAN_DAYS}" value="1" inputmode="numeric">
            <button type="button" class="icon-btn" data-step="1" aria-label="One day more">+</button>
          </div>
          <p class="hint" id="span-hint"></p>
        </div>
        <div data-for="hours" class="stack-sm">
          <div class="pills" role="group" aria-label="Hours">
            ${WINDOWS.map(([k, l]) => `<button type="button" class="pill" data-window="${k}" aria-pressed="false">${l}</button>`).join('')}
          </div>
          <div class="row" id="custom-hours" hidden>
            <div><label for="start">From</label><select id="start">${hourOptions(9 * 60)}</select></div>
            <div><label for="end">Until</label><select id="end">${hourOptions(17 * 60)}</select></div>
          </div>
          <div class="row">
            <div>
              <label for="duration">How long is it?</label>
              <select id="duration">${[60, 120, 180, 240].map((m) => `<option value="${m}"${m === 120 ? ' selected' : ''}>${lengthLabel(m)}</option>`).join('')}</select>
            </div>
            <div>
              <label for="slot">People mark every</label>
              <select id="slot"><option value="60" selected>hour</option><option value="30">half hour</option></select>
            </div>
          </div>
        </div>
      </section>
      ${youFields()}
      ${createBar('Create poll')}
    </form>`;

  const cal = mountCalendar($('#cal'), selected, renderSummary);
  const occasion = wirePlan((o) => {
    if (!o) return;
    $('#span').value = o.days || 1;
    setMark('days');
  });

  function setMark(v) {
    mark = v;
    for (const b of $$('[data-mark]')) b.setAttribute('aria-checked', b.dataset.mark === v);
    for (const el of $$('[data-for]')) el.hidden = el.dataset.for !== v;
    renderSummary();
  }
  function setWindow(k) {
    for (const b of $$('[data-window]')) b.setAttribute('aria-pressed', b.dataset.window === k);
    $('#custom-hours').hidden = k !== 'custom';
    const w = WINDOWS.find((x) => x[0] === k);
    if (w[2] != null) {
      $('#start').value = w[2];
      $('#end').value = w[3];
    }
  }
  const span = () => Math.max(1, Math.min(MAX_SPAN_DAYS, +$('#span').value || 1));
  $('#create').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mark]');
    if (m) setMark(m.dataset.mark);
    const w = e.target.closest('[data-window]');
    if (w) setWindow(w.dataset.window);
    const st = e.target.closest('[data-step]');
    if (st) {
      $('#span').value = Math.max(1, Math.min(MAX_SPAN_DAYS, span() + +st.dataset.step));
      renderSummary();
    }
  });
  $('#span').oninput = renderSummary;

  function renderSummary() {
    const n = selected.size;
    const k = span();
    $('#span-hint').textContent =
      k === 1 ? 'Venn finds the days the most people are free.' : `Venn finds ${k} days in a row that work for the most people.`;
    $('#summary').textContent = n ? `${plural(n, 'day')} to choose from` : '';
  }

  const fill = (n, keep) => {
    selected.clear();
    for (let d = todayStr(), i = 0; selected.size < n && i < 120; d = addDays(d, 1), i++)
      if (keep(dateParts(d).getUTCDay())) selected.add(d);
    cal.show(todayStr());
    renderSummary();
  };
  $('#q-2w').onclick = () => fill(14, () => true);
  $('#q-weekends').onclick = () => fill(12, (wd) => wd === 5 || wd === 6 || wd === 0);
  $('#q-clear').onclick = () => {
    selected.clear();
    cal.render();
    renderSummary();
  };
  $('#tz').onchange = (e) => ($('#tz-name').textContent = tzName(e.target.value));

  $('#create').onsubmit = (e) => {
    e.preventDefault();
    const err = $('#err');
    if (!selected.size) return (err.textContent = 'Pick at least one day.');
    const dates = [...selected];
    const body =
      mark === 'days'
        ? { dates, startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: span() * 1440 }
        : {
            dates,
            startMinute: +$('#start').value,
            endMinute: +$('#end').value,
            slotMinutes: +$('#slot').value,
            durationMinutes: +$('#duration').value,
          };
    if (mark === 'days' && span() > dates.length)
      return (err.textContent = `Pick at least ${span()} days, so there's room for ${span()} in a row.`);
    submit(body, occasion);
  };

  setMark('days');
  setWindow('evening');
  showConfig();
  prefillTitle();
  $('#title').focus();
  return cal.cleanup;
}
