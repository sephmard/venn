// The create pages: a chooser, then one of two quite different polls.
//   /new/pick  You suggest some dates (and times). Everyone votes on each one.
//   /new/free  You pick a range of days. Everyone marks when they're free; Venn finds the overlap.

import { IF_NEEDED, MINUTE, MAX_SPAN_DAYS, YES, addDays, utcToZoned, zonedToUtc } from './core.js';
import { isPhone, monthView, paintView, timeView } from './picker.js';
import {
  $,
  $$,
  api,
  app,
  dateParts,
  dayLabel,
  esc,
  getConfig,
  lastEmail,
  lastName,
  lengthLabel,
  localTz,
  plural,
  rememberEmail,
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
  { emoji: '☕', label: 'Coffee', length: 60, part: 'morning' },
  { emoji: '📚', label: 'Book club', length: 120, part: 'evening' },
  { emoji: '🥞', label: 'Brunch', length: 120, part: 'morning' },
  { emoji: '🎲', label: 'Game night', length: 180, part: 'evening' },
  { emoji: '🥾', label: 'Hike', length: 'allday', part: 'morning' },
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
        <label for="notify">Email me when people answer <span class="muted">(recommended)</span></label>
        <input id="notify" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${esc(lastEmail())}">
        <p class="hint">We'll send one link to confirm it's you. Webhooks for Slack, Discord or your own app are under Notifications once the poll exists.</p>
      </div>
      <p class="hint" id="notify-off" hidden>Email notifications aren't switched on for this Venn server yet. You can add a webhook from the poll's Notifications panel.</p>
      <details class="reveal" id="privacy-opts">
        <summary>Privacy options</summary>
        <label class="switch"><input type="checkbox" role="switch" id="p-email"> Ask everyone for their email</label>
        <p class="hint">Only you see the emails.</p>
        <label class="switch"><input type="checkbox" role="switch" id="p-names"> Hide names from guests</label>
        <p class="hint">Guests see how many people can make each date, but not who.</p>
        <label class="switch"><input type="checkbox" role="switch" id="p-results"> Hide everyone's answers from guests</label>
        <p class="hint">Only you see the answers. Guests see the date once you pick it.</p>
      </details>
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
    $('#title').dispatchEvent(new Event('input')); // a kind of plan also names it
  });
  return () => current;
}

/**
 * Create the poll. `answer` (option start → yes or if needed) is the organizer's own answer,
 * saved straight after so they don't have to vote on their own options.
 */
async function submit(body, occasion, answer = null) {
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
  // Privacy options: only the ones switched on are sent.
  for (const [key, el] of [
    ['requireEmail', '#p-email'],
    ['hideNames', '#p-names'],
    ['hideResults', '#p-results'],
  ])
    if ($(el).checked) body[key] = true;
  const notifyEmail = $('#notify-field').hidden ? '' : $('#notify').value.trim();
  if (notifyEmail) body.notifyEmail = notifyEmail;
  if (body.organizer) rememberName(body.organizer);
  if (notifyEmail) rememberEmail(notifyEmail);
  $('#submit').disabled = true;
  // The celebration (and its picture) load while the poll is saved.
  const celebration = import('./celebrate.js').catch(() => null);
  try {
    const { id, adminToken } = await api('events', { method: 'POST', body });
    save(id, { adminToken, justCreated: true, notifyPending: !!notifyEmail });
    if (answer && Object.keys(answer).length) {
      const me = await api(`events/${id}/participants`, {
        method: 'POST',
        body: { name: body.organizer || 'Host', availability: answer },
      }).catch(() => null);
      if (me) save(id, { participantId: me.id, editToken: me.editToken });
    }
    // A little party, while the poll page loads behind it.
    import('./event.js').catch(() => {});
    const party = (await celebration)?.celebrate({ emoji: body.emoji, title });
    await party?.shown;
    history.pushState(null, '', `/e/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
    scrollTo(0, 0);
    party?.finish();
  } catch (ex) {
    err.textContent = ex.message;
    $('#submit').disabled = false;
  }
}

function showConfig() {
  getConfig().then((c) => {
    if (!$('#notify-field')) return;
    $('#notify-field').hidden = !c.email;
    $('#notify-off').hidden = !!c.email;
  });
}

/** Grey out Create until the poll can be made, and say what's still missing. */
function setReady(missing, ready) {
  $('#submit').disabled = !!missing;
  $('#summary').textContent = missing || ready;
  $('#summary').classList.toggle('missing', !!missing);
}
const named = (occasion) => !!($('#title').value.trim() || occasion()?.label);

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
  [30, '30 min'],
  [60, '1 hour'],
  [90, '1½ hours'],
  [120, '2 hours'],
  [180, '3 hours'],
  ['allday', 'All day'],
  ['days', 'Several days'],
  ['custom', 'Other'],
];
// Start times on offer, every 30 minutes, in three groups.
const TIME_GROUPS = [
  { key: 'morning', label: 'Morning', from: 420, to: 720 },
  { key: 'afternoon', label: 'Afternoon', from: 720, to: 1020 },
  { key: 'evening', label: 'Evening', from: 1020, to: 1380 },
];
const timeRange = shortRange;

export function renderPick() {
  document.title = 'Vote on a few dates · Venn';
  // The options so far, in local time: { date, from, to } in minutes, or { date, days } for all day or longer.
  const items = new Map();
  let length = 120;
  let spanDays = 3;
  let mode = 'calendar'; // 'calendar' (draw on a week) or 'compose' (days, then times)
  let brush = YES; // new options are marked as working for the organizer, or only if needed
  let timeGroup = 'evening';
  // The composer: options appear as soon as there's a day and a start time.
  const days = new Set(); // days picked on the composer's month
  const times = new Set(); // start times used for every picked day
  let focus = null; // a day whose times are being changed on their own, or null for all days
  let view = null; // the week / day picker
  let month = null; // the composer's month

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
          <label for="span">How many days is the trip?</label>
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
        <div class="seg pick-mode" role="radiogroup" aria-label="How to add options" id="pick-mode">
          <button type="button" role="radio" data-pick-mode="calendar">Draw on a week</button>
          <button type="button" role="radio" data-pick-mode="compose">Days, then times</button>
        </div>
        <div class="pick-brush">
          <span class="scope-label" id="brush-l">For you, new options are</span>
          <div class="seg brush" role="radiogroup" aria-labelledby="brush-l">
            <button type="button" role="radio" data-pbrush="${YES}"><span class="swatch swatch-yes"></span>Available</button>
            <button type="button" role="radio" data-pbrush="${IF_NEEDED}"><span class="swatch swatch-maybe"></span>If needed</button>
          </div>
        </div>
        <p class="hint" id="when-hint"></p>
        <div id="picker"></div>
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
    if (o.part) timeGroup = o.part;
    setLength(o.length);
  });

  const timed = () => typeof length === 'number' || length === 'custom';
  const minutes = () => (length === 'custom' ? Math.max(15, Math.min(1440, +$('#custom').value || 60)) : length);
  const onDate = (d) => [...items.values()].filter((it) => it.date === d);
  const mark = (d) => (onDate(d).length ? String(onDate(d).length) : '');
  const tripDays = (it) => it.days || spanDays;

  // ----- adding and removing options -----
  const key = (it) => `${it.date}|${it.from ?? 'day'}`;
  function toggle(it) {
    const k = key(it);
    if (items.has(k) && items.get(k).to === it.to) return tapOption(k);
    items.set(k, { ...it, v: brush }); // one option per start time
    changed();
  }
  /** Tapping an option: give it the current Available / If needed, or take it away if it has it. */
  function tapOption(k) {
    const it = items.get(k);
    if ((it.v || YES) !== brush) {
      it.v = brush;
      return changed();
    }
    remove(k);
  }
  /** An option dragged to a new length, time or day. */
  function reshape(k, date, from, to) {
    const it = items.get(k);
    items.delete(k);
    items.set(`${date}|${from}`, { ...it, date, from, to });
    if (!onDate(it.date).length) days.delete(it.date);
    changed();
  }
  /** Take an option away; a day left with none is no longer picked. */
  function remove(k) {
    const date = items.get(k)?.date;
    items.delete(k);
    if (!onDate(date).length) days.delete(date);
    changed();
  }

  function changed() {
    // Options drawn on the week, or filled in by AI, put their days on the composer's month too.
    for (const it of items.values()) if (it.from != null) days.add(it.date);
    view?.render();
    month?.render();
    renderList();
    renderComposer();
  }

  // ----- the pickers -----
  function mountPicker() {
    view?.cleanup();
    month?.cleanup();
    view = month = null;
    const root = $('#picker');
    $('#pick-mode').hidden = !timed();
    for (const b of $$('[data-pick-mode]')) b.setAttribute('aria-checked', b.dataset.pickMode === mode);
    if (timed() && mode === 'calendar') {
      $('#when-hint').textContent = isPhone()
        ? 'Tap the calendar to add an option of the length above. Drag its top or bottom edge to make it longer or shorter. Tap it to switch between available and if needed, or to remove it.'
        : 'Drag on the calendar to add an option, or click to add one of the length above. Drag an edge to make it longer or shorter, or drag it to another time. Click it to switch between available and if needed, or to remove it.';
      view = timeView(root, {
        label: 'Calendar',
        views: ['week', 'day'],
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
              cls: it.v === IF_NEEDED ? 'opt opt-maybe' : 'opt',
              label: `${it.v === IF_NEEDED ? '~ ' : ''}${timeRange(it.from, it.to)}`,
              short: shortTime(it.from),
              title: `${timeRange(it.from, it.to)}, ${dayLabel(it.date)}, ${it.v === IF_NEEDED ? 'if needed' : 'available'} for you. Tap to change`,
            })),
        onCreate: (date, from, to) => toggle({ date, from, to }),
        onBlock: tapOption,
        onResize: (k, from, to) => reshape(k, items.get(k).date, from, to),
        onMove: reshape,
        marks: mark,
      });
    } else if (timed()) {
      $('#when-hint').textContent = '';
      root.innerHTML = `
        <div class="composer">
          <div class="step">
            <h3><span class="step-n" aria-hidden="true">1</span> Pick the days</h3>
            <p class="hint">Tap the days it could be. Drag across days with a mouse.</p>
            <div id="draft-cal"></div>
          </div>
          <div class="step">
            <h3><span class="step-n" aria-hidden="true">2</span> Pick the start times</h3>
            <div class="seg time-groups" role="radiogroup" aria-label="Part of the day">
              ${TIME_GROUPS.map((g) => `<button type="button" role="radio" data-tgroup="${g.key}">${g.label}</button>`).join('')}
            </div>
            <div class="pills day-scope" id="day-scope" role="group" aria-label="Which days the times are for" hidden></div>
            <div class="pills times" id="times" role="group" aria-label="Start times"></div>
          </div>
          <p class="composer-sum hint" id="draft-sum" aria-live="polite"></p>
        </div>`;
      let before = new Set(days);
      month = monthView($('#draft-cal'), {
        selected: days,
        onChange: () => {
          // A new day gets the start times picked so far; a day taken away loses its options.
          for (const d of days) if (!before.has(d)) for (const m of times) addTime(d, m);
          for (const d of before)
            if (!days.has(d)) {
              for (const [k, it] of items) if (it.date === d && it.from != null) items.delete(k);
              if (focus === d) focus = null;
            }
          before = new Set(days);
          changed();
        },
        marks: mark,
        markLabel: 'options',
      });
      renderComposer();
    } else {
      $('#when-hint').textContent =
        length === 'days'
          ? 'Tap the first day of each trip you could take. The highlighted days show how long each one lasts.'
          : 'Tap each day you want to suggest.';
      const starts = new Set([...items.values()].filter((it) => it.from == null).map((it) => it.date));
      const covered = (d) =>
        length === 'days' &&
        [...items.values()].some((it) => it.from == null && d > it.date && d < addDays(it.date, tripDays(it)));
      month = monthView(root, {
        selected: starts,
        dayClass: (d) => (covered(d) ? 'in-trip' : ''),
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

  // ----- the composer: days × start times -----
  const addTime = (date, from) => items.set(`${date}|${from}`, { date, from, to: Math.min(from + minutes(), 1440), v: brush });
  const timeOn = (m) => (focus ? items.has(`${focus}|${m}`) : times.has(m));
  function renderComposer() {
    if (!$('#times')) return;
    if (focus && !days.has(focus)) focus = null;
    for (const b of $$('[data-tgroup]')) b.setAttribute('aria-checked', b.dataset.tgroup === timeGroup);
    const g = TIME_GROUPS.find((x) => x.key === timeGroup);
    let h = '';
    for (let m = g.from; m < g.to; m += 30)
      h += `<button type="button" class="pill time" data-time="${m}" aria-pressed="${timeOn(m)}">${esc(shortTime(m))}</button>`;
    $('#times').innerHTML = h;
    // With several days picked, the times can apply to all of them or to one day.
    const picked = [...days].sort();
    $('#day-scope').hidden = picked.length < 2;
    $('#day-scope').innerHTML =
      picked.length < 2
        ? ''
        : `<span class="scope-label" aria-hidden="true">Times for</span><button type="button" class="pill" data-scope="" aria-pressed="${!focus}">All days</button>${picked
            .map(
              (d) =>
                `<button type="button" class="pill" data-scope="${d}" aria-pressed="${focus === d}">${esc(dayLabel(d))}</button>`,
            )
            .join('')}`;
    const n = [...items.values()].filter((it) => it.from != null).length;
    $('#draft-sum').textContent = !days.size
      ? 'Pick at least one day.'
      : !n
        ? 'Now pick a start time. Options appear below as you go.'
        : focus
          ? `Changing the times on ${dayLabel(focus)} only. ${plural(n, 'option')} in your poll.`
          : `${plural(n, 'option')} in your poll, ${lengthLabel(minutes())} each.`;
  }
  $('#picker').addEventListener('click', (e) => {
    const g = e.target.closest('[data-tgroup]');
    if (g) {
      timeGroup = g.dataset.tgroup;
      return renderComposer();
    }
    const sc = e.target.closest('[data-scope]');
    if (sc) {
      focus = sc.dataset.scope || null;
      return renderComposer();
    }
    const t = e.target.closest('[data-time]');
    if (!t) return;
    const m = +t.dataset.time;
    const on = !timeOn(m);
    const targets = focus ? [focus] : [...days];
    if (!focus) on ? times.add(m) : times.delete(m);
    for (const d of targets) on ? addTime(d, m) : items.delete(`${d}|${m}`);
    changed();
  });

  // ----- the options in the poll, by day -----
  const itemLabel = (it) =>
    it.from != null
      ? timeRange(it.from, it.to)
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
      box.innerHTML = `<p class="hint">Nothing yet. ${timed() ? 'Pick days and start times above, then press Add.' : 'Tap days on the calendar above.'} Everyone will say yes, if needed or no to each option you add.</p>`;
      return;
    }
    const removeBtn = (k, label) => `<button type="button" data-remove="${esc(k)}" aria-label="Remove ${esc(label)}">×</button>`;
    let rows;
    if (length === 'days') {
      rows = list
        .map(
          ([k, it]) => `<li class="od-row">
            <span class="chip trip">${esc(itemLabel(it))}${removeBtn(k, itemLabel(it))}</span>
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
                  `<span class="chip${it.v === IF_NEEDED ? ' maybe' : ''}">${it.v === IF_NEEDED ? '<span aria-hidden="true">~</span> ' : ''}${esc(itemLabel(it))}${it.v === IF_NEEDED ? '<span class="sr-only"> (if needed)</span>' : ''}${removeBtn(k, `${dayLabel(d)}, ${itemLabel(it)}`)}</span>`,
              )
              .join('')}</span>
            ${timed() ? `<button type="button" class="pill pill-quiet od-add" data-add-to="${d}" aria-label="Add a time on ${esc(dayLabel(d))}">+ Time</button>` : ''}
          </li>`,
        )
        .join('');
    }
    box.innerHTML = `<p class="preview-lede">Guests will choose from <b>${plural(list.length, 'option')}</b>.</p>
      <ul class="od-list">${rows}</ul>
      <button type="button" class="link-btn" id="clear-options">Remove all</button>`;
  }
  $('#options-list').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) remove(rm.dataset.remove);
    const trip = e.target.closest('[data-trip]');
    if (trip) {
      const it = items.get(trip.dataset.trip);
      it.days = Math.max(2, Math.min(MAX_SPAN_DAYS, tripDays(it) + +trip.dataset.d));
      changed();
      $(`[data-trip="${trip.dataset.trip}"][data-d="${trip.dataset.d}"]`)?.focus();
    }
    const add = e.target.closest('[data-add-to]');
    if (add) {
      // Change the times on this day only.
      if (mode !== 'compose') setMode('compose');
      focus = add.dataset.addTo;
      month?.show(focus);
      renderComposer();
      $('#times')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#times .pill')?.focus({ preventScroll: true });
    }
    if (e.target.closest('#clear-options') && confirm('Remove all the options?')) {
      items.clear();
      days.clear();
      focus = null;
      changed();
    }
    if (!timed() && (rm || e.target.closest('#clear-options'))) mountPicker();
  });

  function setMode(m) {
    mode = m;
    mountPicker();
  }
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
  $('#pick-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick-mode]');
    if (b) setMode(b.dataset.pickMode);
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
    // A new length applies to the options already added.
    if (timed()) for (const it of items.values()) it.to = Math.min(it.from + minutes(), 1440);
    else for (const it of items.values()) it.days = v === 'days' ? spanDays : 1;
    // Keep the composer (and the month it shows) when only the number of hours changes.
    if (wasTimed !== timed() || !timed() || (!view && !month)) mountPicker();
    else changed();
    renderList();
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
  $('#custom').oninput = () => {
    for (const it of items.values()) if (it.from != null) it.to = Math.min(it.from + minutes(), 1440);
    changed();
  };
  $('#tz').onchange = (e) => ($('#tz-name').textContent = tzName(e.target.value));

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
    if (!items.size) return ($('#err').textContent = 'Add at least one option to vote on.');
    // The organizer's own answer, from how each option was marked.
    const answer = {};
    options().forEach((o, i) => (answer[o.start] = sorted()[i][1].v || YES));
    submit({ mode: 'options', options: options() }, occasion, answer);
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
      if (first) (view || month)?.show(first);
      changed();
      $('#preview-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(`Filled in ${plural(draft.options.length, 'option')}. Check them, then create the poll.`);
    } catch (ex) {
      toast(ex.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Fill it in';
    }
  };

  function updateReady() {
    const n = items.size;
    setReady(
      !n ? 'Add at least one option to create the poll' : !named(occasion) ? 'Give your plan a name to create the poll' : '',
      `${plural(n, 'option')} to vote on`,
    );
  }
  $('#title').addEventListener('input', updateReady);

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

const FREE_LENGTHS = [
  [30, '30 min'],
  [60, '1 hour'],
  [90, '1½ hours'],
  [120, '2 hours'],
  [180, '3 hours'],
  [240, '4 hours'],
  ['allday', 'All day'],
  ['days', 'Several days'],
];
// Quick fills for the painter: parts of the day, painted on every day of the week shown.
const FILLS = [
  ['Mornings', 480, 720],
  ['Afternoons', 720, 1020],
  ['Evenings', 1020, 1380],
  ['All day', 480, 1380],
];

/** Painted "date|minutes" keys as windows: [{ date, start, end }], 30-minute steps merged. */
function toWindows(painted) {
  const byDate = new Map();
  for (const k of painted) {
    const [d, m] = k.split('|');
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(+m);
  }
  const out = [];
  for (const d of [...byDate.keys()].sort()) {
    let cur = null;
    for (const m of byDate.get(d).sort((a, b) => a - b)) {
      if (cur && cur.end === m) cur.end = m + 30;
      else out.push((cur = { date: d, start: m, end: m + 30 }));
    }
  }
  return out;
}

export function renderFree() {
  document.title = 'Ask when people are free · Venn';
  const painted = new Set(); // "YYYY-MM-DD|minutes" for hours
  const selected = new Set(); // whole days
  let length = 120;
  let painter = null;
  let cal = null;

  app.innerHTML = `
    <form id="create" class="create" novalidate>
      <a class="back" href="/new" data-link>‹ Both kinds of poll</a>
      <h1>Ask when people are free</h1>
      ${planFields('free')}
      <section class="sheet" aria-labelledby="length-h">
        <h2 id="length-h">How long is it?</h2>
        <div class="pills" role="group" aria-label="How long">
          ${FREE_LENGTHS.map(([v, l]) => `<button type="button" class="pill" data-flength="${v}" aria-pressed="false">${l}</button>`).join('')}
        </div>
        <div class="inline-field" id="span-field" hidden>
          <label for="span">How many days in a row?</label>
          <div class="stepper">
            <button type="button" class="icon-btn" data-step="-1" aria-label="One day fewer">−</button>
            <input id="span" type="number" min="2" max="${MAX_SPAN_DAYS}" value="3" inputmode="numeric">
            <button type="button" class="icon-btn" data-step="1" aria-label="One day more">+</button>
          </div>
        </div>
      </section>
      <section class="sheet" aria-labelledby="when-h">
        <h2 id="when-h">When could it be?</h2>
        <p class="hint" id="when-hint"></p>
        <div id="when"></div>
        <div class="pills quick" role="group" aria-label="Quick picks" id="quick"></div>
      </section>
      <section class="sheet poll-preview" aria-labelledby="preview-h">
        <h2 id="preview-h">What your guests will mark</h2>
        <div id="free-list" class="opt-list" aria-live="polite"></div>
      </section>
      ${youFields()}
      ${createBar('Create poll')}
    </form>`;

  const occasion = wirePlan((o) => {
    if (!o) return;
    if (o.days) $('#span').value = o.days;
    setLength(o.length);
  });

  const hoursMode = () => typeof length === 'number';
  const span = () => (length === 'days' ? Math.max(2, Math.min(MAX_SPAN_DAYS, +$('#span').value || 2)) : 1);

  function setLength(v) {
    const was = hoursMode();
    length = v;
    for (const b of $$('[data-flength]')) b.setAttribute('aria-pressed', b.dataset.flength === String(v));
    $('#span-field').hidden = v !== 'days';
    if (was !== hoursMode() || (!painter && !cal)) mount();
    update();
  }

  function mount() {
    painter?.cleanup();
    cal?.cleanup();
    painter = cal = null;
    const root = $('#when');
    if (hoursMode()) {
      $('#when-hint').textContent = isPhone()
        ? 'Drag down the calendar to paint the times people could meet; start on a painted time to erase. Tap a day name for the whole day. Scroll with the times on the left.'
        : 'Drag across the calendar to paint the times people could meet; start on a painted time to erase. Click a day name for the whole day.';
      painter = paintView(root, { selected: painted, onChange: update });
      $('#quick').innerHTML = `<span class="scope-label">Fill this week:</span>${FILLS.map(
        ([l, a, b], i) =>
          `<button type="button" class="pill" data-fill="${i}">${l} <small>${esc(shortRange(a, b))}</small></button>`,
      ).join('')}<button type="button" class="pill pill-quiet" id="q-clear">Clear all</button>`;
    } else {
      $('#when-hint').textContent = 'Tap or drag across the days that could work. People will mark the ones they’re free.';
      cal = monthView(root, { selected, onChange: update });
      $('#quick').innerHTML = `
        <button type="button" class="pill" id="q-2w">Next 2 weeks</button>
        <button type="button" class="pill" id="q-weekends">Next 4 weekends</button>
        <button type="button" class="pill pill-quiet" id="q-clear">Clear all</button>`;
    }
  }

  // Quick picks
  const fill = (n, keep) => {
    selected.clear();
    for (let d = todayStr(), i = 0; selected.size < n && i < 120; d = addDays(d, 1), i++)
      if (keep(dateParts(d).getUTCDay())) selected.add(d);
    cal.show(todayStr());
    update();
  };
  $('#create').addEventListener('click', (e) => {
    const l = e.target.closest('[data-flength]');
    if (l) setLength(Number.isNaN(+l.dataset.flength) ? l.dataset.flength : +l.dataset.flength);
    const st = e.target.closest('#span-field [data-step]');
    if (st) {
      $('#span').value = Math.max(2, Math.min(MAX_SPAN_DAYS, span() + +st.dataset.step));
      update();
    }
    const f = e.target.closest('[data-fill]');
    if (f) {
      // Paint that part of the day on every day of the week shown, or clear it if it's all painted.
      const [, a, b] = FILLS[+f.dataset.fill];
      const keys = painter.week().flatMap((d) => Array.from({ length: (b - a) / 30 }, (_, i) => `${d}|${a + i * 30}`));
      const all = keys.every((k) => painted.has(k));
      for (const k of keys) all ? painted.delete(k) : painted.add(k);
      painter.render();
      update();
    }
    if (e.target.closest('#q-2w')) fill(14, () => true);
    if (e.target.closest('#q-weekends')) fill(12, (wd) => wd === 5 || wd === 6 || wd === 0);
    if (e.target.closest('#q-clear')) {
      painted.clear();
      selected.clear();
      painter?.render();
      cal?.render();
      update();
    }
    const rm = e.target.closest('[data-rm-window]');
    if (rm) {
      const [ds, a, b] = rm.dataset.rmWindow.split('|');
      for (const d of ds.split(',')) for (let m = +a; m < +b; m += 30) painted.delete(`${d}|${m}`);
      painter.render();
      update();
    }
    const rd = e.target.closest('[data-rm-day]');
    if (rd) {
      selected.delete(rd.dataset.rmDay);
      cal.render();
      update();
    }
  });
  $('#span').oninput = update;
  $('#title').addEventListener('input', update);
  $('#tz').onchange = (e) => ($('#tz-name').textContent = tzName(e.target.value));

  /** Days in a row with the same hours, together: [{ dates, ranges: [[start, end]] }]. */
  function groups(windows) {
    const out = [];
    for (const d of [...new Set(windows.map((w) => w.date))]) {
      const ranges = windows.filter((w) => w.date === d).map((w) => [w.start, w.end]);
      const last = out.at(-1);
      if (last && addDays(last.dates.at(-1), 1) === d && JSON.stringify(last.ranges) === JSON.stringify(ranges))
        last.dates.push(d);
      else out.push({ dates: [d], ranges });
    }
    return out;
  }

  /** "Nov 1 – Nov 14" or "Sat, Nov 7". */
  const dayRange = (dates) => (dates.length === 1 ? dayLabel(dates[0]) : `${dayLabel(dates[0])} – ${dayLabel(dates.at(-1))}`);

  // The list of what guests will be able to mark, and whether the poll can be created yet.
  function update() {
    const box = $('#free-list');
    const rmBtn = (attr, label) => `<button type="button" ${attr} aria-label="Remove ${esc(label)}">×</button>`;
    if (hoursMode()) {
      const windows = toWindows(painted);
      const dates = [...new Set(windows.map((w) => w.date))];
      const long = windows.some((w) => w.end - w.start >= length);
      box.innerHTML = windows.length
        ? `<p class="preview-lede">Guests will mark when they’re free in these times, in 30-minute steps. Venn looks for <b>${esc(lengthLabel(length))}</b> that works for the most people.</p>
          <ul class="od-list">${groups(windows)
            .map(
              (g) =>
                `<li class="od-row"><span class="od-date">${esc(dayRange(g.dates))}</span><span class="chips">${g.ranges
                  .map(
                    ([a, b]) =>
                      `<span class="chip">${esc(shortRange(a, b))}${rmBtn(`data-rm-window="${g.dates.join(',')}|${a}|${b}"`, `${dayRange(g.dates)}, ${shortRange(a, b)}`)}</span>`,
                  )
                  .join('')}</span></li>`,
            )
            .join('')}</ul>`
        : '<p class="hint">Nothing yet. Paint some times on the calendar above, or use a quick fill.</p>';
      setReady(
        !windows.length
          ? 'Paint at least one time to create the poll'
          : !long
            ? `Your times are shorter than ${lengthLabel(length)}. Paint a longer stretch`
            : !named(occasion)
              ? 'Give your plan a name to create the poll'
              : '',
        `${plural(dates.length, 'day')} to choose from`,
      );
    } else {
      const dates = [...selected].sort();
      const k = span();
      box.innerHTML = dates.length
        ? `<p class="preview-lede">Guests will mark the whole days they’re free on <b>${plural(dates.length, 'day')}</b> (${esc(dayRange(dates))}). ${
            k > 1
              ? `Venn looks for ${k} days in a row that work for the most people.`
              : 'Venn finds the days the most people are free.'
          }</p><div class="chips">${dates
            .map((d) => `<span class="chip">${esc(dayLabel(d))}${rmBtn(`data-rm-day="${d}"`, dayLabel(d))}</span>`)
            .join('')}</div>`
        : '<p class="hint">Nothing yet. Pick some days on the calendar above.</p>';
      setReady(
        !dates.length
          ? 'Pick at least one day to create the poll'
          : k > dates.length
            ? `Pick at least ${k} days, for ${k} in a row`
            : !named(occasion)
              ? 'Give your plan a name to create the poll'
              : '',
        `${plural(dates.length, 'day')} to choose from`,
      );
    }
  }

  $('#create').onsubmit = (e) => {
    e.preventDefault();
    if ($('#submit').disabled) return;
    if (hoursMode()) return submit({ windows: toWindows(painted), slotMinutes: 30, durationMinutes: length }, occasion);
    const k = span();
    submit(
      { dates: [...selected].sort(), startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: k * 1440 },
      occasion,
    );
  };

  setLength(120);
  showConfig();
  prefillTitle();
  $('#title').focus();
  return () => {
    painter?.cleanup();
    cal?.cleanup();
  };
}
