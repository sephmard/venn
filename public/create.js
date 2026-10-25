// The create pages: a chooser, then one of two quite different polls.
//   /new/pick  You suggest some dates (and times). Everyone votes on each one.
//   /new/free  You pick a range of days. Everyone marks when they're free; Venn finds the overlap.

import { DAY_PARTS, MINUTE, MAX_SPAN_DAYS, addDays, utcToZoned, zonedToUtc } from './core.js';
import { isPhone, monthView, timeView } from './picker.js';
import {
  $,
  $$,
  api,
  app,
  dateParts,
  dayLabel,
  esc,
  getConfig,
  lastName,
  lengthLabel,
  localTz,
  minutesLabel,
  plural,
  rememberName,
  shortRange,
  shortTime,
  save,
  toast,
  todayStr,
  tzName,
  tzOptions,
} from './ui.js';

// Kinds of plans, with sensible defaults. `length` is minutes, or 'days' for a trip; `part` is the
// part of the day it usually happens in, for "ask when people are free" polls.
const OCCASIONS = [
  { emoji: '🍝', label: 'Dinner', length: 120, part: 'evening' },
  { emoji: '🍻', label: 'Drinks', length: 120, part: 'evening' },
  { emoji: '📚', label: 'Book club', length: 120, part: 'evening' },
  { emoji: '🥞', label: 'Brunch', length: 120, part: 'morning' },
  { emoji: '🎲', label: 'Game night', length: 180, part: 'evening' },
  { emoji: '🥾', label: 'Hike', length: 240, part: 'morning' },
  { emoji: '🎉', label: 'Party', length: 240, part: 'evening' },
  { emoji: '✈️', label: 'Trip', length: 'days', days: 3 },
];

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
          <input id="title" type="text" maxlength="120" placeholder="${kind === 'free' ? 'Summer cabin trip' : "Dinner at Luca's"}" required>
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
const timeRange = shortRange;

export function renderPick() {
  document.title = 'Vote on a few dates · Venn';
  // The options so far, in local time: { date, from, to } in minutes, or { date, days } for all day or longer.
  const items = new Map();
  let length = 120;
  let spanDays = 3;
  let openDay = null; // the day open in the month view
  let view = null; // the week / day / month picker, while the length is in hours
  let month = null; // the month picker, for all-day options and trips

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
      <section class="sheet" aria-labelledby="length-h">
        <h2 id="length-h">How long is it?</h2>
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
      <section class="sheet" aria-labelledby="when-h">
        <h2 id="when-h">When could it be?</h2>
        <p class="hint" id="when-hint"></p>
        <div id="picker"></div>
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
  });

  const timed = () => typeof length === 'number' || length === 'custom';
  const minutes = () => (length === 'custom' ? Math.max(15, Math.min(1440, +$('#custom').value || 60)) : length);
  const onDate = (d) => [...items.values()].filter((it) => it.date === d);
  const mark = (d) => (onDate(d).length ? String(onDate(d).length) : '');

  // ----- adding and removing options -----
  const key = (it) => `${it.date}|${it.from ?? 'day'}`;
  function toggle(it) {
    const k = key(it);
    if (items.has(k) && items.get(k).to === it.to) items.delete(k);
    else items.set(k, it); // one option per start time
    changed();
  }
  const remove = (k) => {
    items.delete(k);
    changed();
  };

  function changed() {
    // The month view only needs its marks refreshed; re-creating it would jump back to this month.
    if (view && view.view !== 'month') view.render();
    month?.render();
    if (openDay) renderDayPanel();
    renderList();
  }

  // ----- the pickers -----
  function mountPicker() {
    view?.cleanup();
    month?.cleanup();
    view = month = null;
    const root = $('#picker');
    if (timed()) {
      $('#when-hint').textContent = isPhone()
        ? 'Tap the calendar to add an option of the length above, and tap an option to remove it. Or use Month to pick a day, then morning, afternoon or evening.'
        : 'Drag on the calendar to add an option, or click to add one of the length above. Click an option to remove it. Or use Month to pick a day, then morning, afternoon or evening.';
      view = timeView(root, {
        label: 'Calendar',
        range: () => [420, 1440],
        tapLength: minutes,
        blocks: () =>
          [...items.entries()]
            .filter(([, it]) => it.from != null)
            .map(([k, it]) => ({
              key: k,
              date: it.date,
              from: it.from,
              to: Math.min(it.to, 1440),
              cls: 'opt',
              label: timeRange(it.from, it.to),
              short: shortTime(it.from),
              title: `${timeRange(it.from, it.to)}, ${dayLabel(it.date)}. Remove this option`,
            })),
        onCreate: (date, from, to) => toggle({ date, from, to }),
        onBlock: remove,
        marks: mark,
        month: monthPanel,
      });
    } else {
      $('#when-hint').textContent =
        length === 'days'
          ? `Tap each day the trip could start. Each option lasts ${spanDays} days.`
          : 'Tap each day you want to suggest.';
      const picked = new Set([...items.values()].filter((it) => it.from == null).map((it) => it.date));
      month = monthView(root, {
        selected: picked,
        marks: () => '',
        onChange: () => {
          for (const [k, it] of items) if (it.from == null && !picked.has(it.date)) items.delete(k);
          for (const d of picked) if (!items.has(`${d}|day`)) items.set(`${d}|day`, { date: d, days: 0 });
          renderList();
        },
      });
    }
  }

  // Month view for options in hours: open a day, then pick parts of it or an exact time.
  function monthPanel(el) {
    el.innerHTML = '<div class="month-cal"></div><div class="day-panel" aria-live="polite"></div>';
    const m = monthView($('.month-cal', el), {
      onDay: (d) => {
        openDay = d;
        m.render();
        renderDayPanel();
      },
      active: () => openDay,
      marks: mark,
      markLabel: 'options',
    });
    month = m;
    if (openDay) m.show(openDay); // back to the month of the open day
    renderDayPanel();
    return () => {
      m.cleanup();
      if (month === m) month = null;
    };
  }

  function renderDayPanel() {
    const panel = $('.day-panel');
    if (!panel) return;
    if (!openDay) {
      panel.innerHTML = '<p class="hint">Pick a day to add options to it.</p>';
      return;
    }
    const has = (from, to) => items.get(`${openDay}|${from}`)?.to === to;
    const parts = DAY_PARTS.map(
      (p) =>
        `<button type="button" class="pill part" data-part="${p.key}" aria-pressed="${has(p.start, p.end)}">${p.label} <small>${esc(timeRange(p.start, p.end))}</small></button>`,
    ).join('');
    const exact = onDate(openDay)
      .filter((it) => it.from != null && !DAY_PARTS.some((p) => p.start === it.from && p.end === it.to))
      .map(
        (it) =>
          `<span class="chip">${esc(timeRange(it.from, it.to))}<button type="button" data-remove="${esc(key(it))}" aria-label="Remove ${esc(timeRange(it.from, it.to))}">×</button></span>`,
      )
      .join('');
    panel.innerHTML = `
      <h3>${esc(dayLabel(openDay))}</h3>
      <div class="pills" role="group" aria-label="Parts of ${esc(dayLabel(openDay))}">${parts}</div>
      ${exact ? `<div class="chips">${exact}</div>` : ''}
      <div class="other-time">
        <label for="exact">Or an exact time</label>
        <input type="time" id="exact" step="900">
        <button type="button" class="pill pill-quiet" id="add-exact">Add</button>
      </div>`;
  }
  $('#picker').addEventListener('click', (e) => {
    const part = e.target.closest('[data-part]');
    if (part) {
      const p = DAY_PARTS.find((x) => x.key === part.dataset.part);
      return toggle({ date: openDay, from: p.start, to: p.end });
    }
    if (e.target.closest('#add-exact')) {
      const v = $('#exact').value;
      if (!v) return $('#exact').focus();
      const [h, mm] = v.split(':').map(Number);
      const from = h * 60 + mm;
      items.set(`${openDay}|${from}`, { date: openDay, from, to: Math.min(from + minutes(), 1440) });
      return changed();
    }
    const rm = e.target.closest('.day-panel [data-remove]');
    if (rm) remove(rm.dataset.remove);
  });

  // ----- the list of options, under the calendar -----
  const itemLabel = (it) =>
    it.from != null
      ? `${dayLabel(it.date)}, ${timeRange(it.from, it.to)}`
      : length === 'days'
        ? `${dayLabel(it.date)} – ${dayLabel(addDays(it.date, spanDays - 1))}`
        : `${dayLabel(it.date)}, all day`;
  const sorted = () =>
    [...items.entries()].sort(([, a], [, b]) => a.date.localeCompare(b.date) || (a.from ?? -1) - (b.from ?? -1));
  function renderList() {
    const list = sorted();
    $('#options-list').innerHTML = list.length
      ? `<h3>${plural(list.length, 'option')}</h3><div class="chips">${list
          .map(
            ([k, it]) =>
              `<span class="chip">${esc(itemLabel(it))}<button type="button" data-remove="${esc(k)}" aria-label="Remove ${esc(itemLabel(it))}">×</button></span>`,
          )
          .join('')}</div>`
      : '';
    $('#summary').textContent = list.length ? `${plural(list.length, 'option')} to vote on` : '';
  }
  $('#options-list').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) remove(rm.dataset.remove);
    if (!timed()) mountPicker();
  });

  // ----- length -----
  function setLength(v) {
    const wasTimed = timed();
    length = v;
    for (const b of $$('[data-length]')) b.setAttribute('aria-pressed', b.dataset.length === String(v));
    $('#span-field').hidden = v !== 'days';
    $('#custom-field').hidden = v !== 'custom';
    // Options in hours and whole-day options don't mix: switching between them starts over.
    if (wasTimed !== timed() && items.size) {
      items.clear();
      toast('Options cleared for the new length');
    }
    if (!view || wasTimed !== timed() || !timed()) mountPicker();
    renderList();
  }
  $('#create').addEventListener('click', (e) => {
    const b = e.target.closest('[data-length]');
    if (b) setLength(Number.isNaN(+b.dataset.length) ? b.dataset.length : +b.dataset.length);
    const st = e.target.closest('#span-field [data-step]');
    if (st) {
      $('#span').value = Math.max(2, Math.min(MAX_SPAN_DAYS, (+$('#span').value || 3) + +st.dataset.step));
      spanDays = +$('#span').value;
      mountPicker();
      renderList();
    }
  });
  $('#span').oninput = () => {
    spanDays = Math.max(2, Math.min(MAX_SPAN_DAYS, +$('#span').value || 2));
    renderList();
  };
  $('#tz').onchange = (e) => ($('#tz-name').textContent = tzName(e.target.value));

  function options() {
    const tz = $('#tz').value;
    return sorted().map(([, it]) => {
      if (it.from == null)
        return { start: zonedToUtc(it.date, 0, tz), end: zonedToUtc(addDays(it.date, length === 'days' ? spanDays : 1), 0, tz) };
      const start = zonedToUtc(it.date, it.from, tz);
      return { start, end: start + (it.to - it.from) * MINUTE };
    });
  }

  $('#create').onsubmit = (e) => {
    e.preventDefault();
    if (!items.size) return ($('#err').textContent = 'Add at least one option to vote on.');
    submit({ mode: 'options', options: options() }, occasion);
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
      const preset = LENGTHS.some(([v]) => v === draft.durationMinutes);
      if (!preset) $('#custom').value = draft.durationMinutes;
      setLength(preset ? draft.durationMinutes : 'custom');
      items.clear();
      for (const o of draft.options) {
        const z = utcToZoned(o.start, tz);
        items.set(`${z.date}|${z.minutes}`, { date: z.date, from: z.minutes, to: Math.min(z.minutes + minutes(), 1440) });
      }
      const first = sorted()[0]?.[1].date;
      if (first) view.show(first);
      changed();
      $('#when-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  return () => {
    view?.cleanup();
    month?.cleanup();
  };
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
  const parts = new Set(DAY_PARTS.map((p) => p.key));
  let mark = 'parts';

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
          <button type="button" role="radio" data-mark="parts">Parts of the day</button>
          <button type="button" role="radio" data-mark="days">Whole days</button>
          <button type="button" role="radio" data-mark="hours">Hours</button>
        </div>
        <div data-for="parts" class="inline-field">
          <p class="hint" id="parts-hint">People tap the mornings, afternoons and evenings they're free.</p>
          <div class="pills" role="group" aria-label="Parts of the day to ask about">
            ${DAY_PARTS.map((p) => `<button type="button" class="pill part" data-ask="${p.key}" aria-pressed="true">${p.label} <small>${esc(shortRange(p.start, p.end))}</small></button>`).join('')}
          </div>
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

  const cal = monthView($('#cal'), { selected, onChange: renderSummary });
  const occasion = wirePlan((o) => {
    if (!o) return;
    $('#span').value = o.days || 1;
    if (o.part) {
      parts.clear();
      parts.add(o.part);
      for (const b of $$('[data-ask]')) b.setAttribute('aria-pressed', parts.has(b.dataset.ask));
    }
    setMark(o.days ? 'days' : 'parts');
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
    const a = e.target.closest('[data-ask]');
    if (a) {
      if (parts.has(a.dataset.ask)) parts.delete(a.dataset.ask);
      else parts.add(a.dataset.ask);
      a.setAttribute('aria-pressed', parts.has(a.dataset.ask));
      renderSummary();
    }
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
    $('#summary').textContent = !n
      ? ''
      : mark === 'parts' && parts.size
        ? `${plural(n * parts.size, 'time')} to choose from`
        : `${plural(n, 'day')} to choose from`;
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
    const dates = [...selected].sort();
    if (mark === 'parts') {
      if (!parts.size) return (err.textContent = 'Pick at least one part of the day.');
      const tz = $('#tz').value;
      const options = dates.flatMap((d) =>
        DAY_PARTS.filter((p) => parts.has(p.key)).map((p) => ({
          start: zonedToUtc(d, p.start, tz),
          end: zonedToUtc(d, p.end, tz),
        })),
      );
      return submit({ mode: 'options', layout: 'parts', options }, occasion);
    }
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

  setMark('parts');
  setWindow('evening');
  showConfig();
  prefillTitle();
  $('#title').focus();
  return cal.cleanup;
}
