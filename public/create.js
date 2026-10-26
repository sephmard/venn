// The create pages: a chooser, then one of two quite different polls.
//   /new/pick  You suggest some dates (and times). Everyone votes on each one.
//   /new/free  You pick a range of days. Everyone marks when they're free; Venn finds the overlap.

import {
  DAY_PARTS,
  IF_NEEDED,
  MINUTE,
  MAX_SPAN_DAYS,
  YES,
  addDays,
  allDaySpan,
  longestRun,
  utcToZoned,
  zonedToUtc,
} from './core.js';
import { editBlocks } from './block-edit.js';
import { paintView } from './paint.js';
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
  saved,
  toast,
  todayStr,
} from './ui.js';

// The organizer's privacy choices, and their switches in "Privacy options".
const PRIVACY = [
  ['requireEmail', '#p-email'],
  ['hideNames', '#p-names'],
  ['hideResults', '#p-results'],
];

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

// ---------- editing or duplicating a poll ----------

// ?edit=<id> changes that poll (only while nobody else has answered); ?copy=<id> starts a new poll
// from it. The organizer tools on the poll page link here.
let editing = null; // the poll being changed, or null when creating one

function source() {
  const q = new URLSearchParams(location.search);
  const id = q.get('edit') || q.get('copy');
  return id && { id, edit: q.has('edit') };
}

/** The poll to start from, with the organizer's view of it when this device has their link. */
async function loadSource(src) {
  const token = saved(src.id).adminToken;
  try {
    return await api(`events/${src.id}`, { headers: token ? { 'x-admin-token': token } : {} });
  } catch (ex) {
    toast(ex.message);
    return null;
  }
}

/** Fill in everything both kinds of poll share: the plan, the organizer and the privacy options. */
function fillCommon(ev, src) {
  const i = OCCASIONS.findIndex((o) => o.emoji === ev.emoji);
  if (i >= 0) $(`[data-occasion="${i}"]`).click();
  $('#title').value = ev.title;
  $('#location').value = ev.location || '';
  $('#desc').value = ev.description || '';
  $('#desc-box').open = !!ev.description;
  $('#organizer').value = ev.organizer || '';
  // Times are in the organizer's time zone (everyone sees them in their own); a poll keeps its own.
  if (ev.timezone) $('#tz').value = ev.timezone;
  for (const [key, el] of PRIVACY) $(el).checked = !!ev[key];
  $('#privacy-opts').open = PRIVACY.some(([key]) => ev[key]);
  if (src.edit) {
    editing = src.id;
    $('#create h1').textContent = 'Edit your poll';
    $('#create .back').textContent = '‹ Back to the poll';
    $('#create .back').setAttribute('href', `/e/${src.id}`);
    $('#submit').textContent = 'Save changes';
    $('#notify-field').remove(); // notifications have their own panel on the poll
    $('#notify-off').remove();
  } else toast('Copied. Change anything you like, then create the new poll.');
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
          <label for="title">Name of your poll</label>
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
        <label for="notify">Your email</label>
        <input id="notify" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${esc(lastEmail())}" aria-describedby="notify-hint">
        <p class="hint" id="notify-hint">We'll email you your poll's link, so you never lose it, then let you know when people answer. Webhooks for Slack, Discord or your own app are under Notifications once the poll exists.</p>
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
      <input type="hidden" id="tz" value="${esc(localTz)}">
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
 * saved with the poll so they don't have to vote on their own options.
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
  for (const [key, el] of PRIVACY) body[key] = $(el).checked;
  if (emailMissing()) {
    err.textContent = emailMissing();
    $('#notify').focus();
    return;
  }
  const notifyEmail = !$('#notify-field') || $('#notify-field').hidden ? '' : $('#notify').value.trim();
  if (notifyEmail) body.notifyEmail = notifyEmail;
  if (body.organizer) rememberName(body.organizer);
  if (notifyEmail) rememberEmail(notifyEmail);
  $('#submit').disabled = true;
  // The organizer's own answer: what they marked for each option, or yes to all the times offered.
  if (answer && Object.keys(answer).length) body.hostAvailability = answer;
  if (editing) return saveEdit(body);
  body.hostAnswers = true;
  // The celebration (and its picture) load while the poll is saved.
  const celebration = import('./celebrate.js').catch(() => null);
  try {
    const { id, adminToken, participant } = await api('events', { method: 'POST', body });
    save(id, {
      adminToken,
      justCreated: true,
      notifyPending: !!notifyEmail,
      ...(participant && { participantId: participant.id, editToken: participant.editToken }),
    });
    // A little party, while the poll page loads behind it.
    import('./event.js').catch(() => {});
    // The main button shares the poll: the phone's share sheet, or the link copied.
    const url = `${location.origin}/e/${id}`;
    let copying = null; // the link being copied, so its toast can show once the poll is open
    const share = () => {
      if (navigator.share && matchMedia('(pointer: coarse)').matches)
        navigator.share({ title, text: `When works for you? ${title}`, url }).catch(() => {});
      else
        copying = navigator.clipboard.writeText(url).then(
          () => true,
          () => false,
        );
    };
    const party = (await celebration)?.celebrate({ emoji: body.emoji, title, share });
    await party?.shown;
    history.pushState(null, '', `/e/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
    scrollTo(0, 0);
    party?.finish();
    // Opening the poll clears any toast, so say the link was copied after it.
    if (copying) (await copying) ? toast('Invite link copied. Paste it in your group chat.') : prompt('Copy this:', url);
  } catch (ex) {
    err.textContent = ex.message;
    $('#submit').disabled = false;
  }
}

/** Save the changes to a poll nobody else has answered yet, and go back to it. */
async function saveEdit(body) {
  const id = editing;
  try {
    await api(`events/${id}`, { method: 'PUT', body, headers: { 'x-admin-token': saved(id).adminToken || '' } });
    history.pushState(null, '', `/e/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
    scrollTo(0, 0);
    toast('Poll updated');
  } catch (ex) {
    $('#err').textContent = ex.message;
    $('#submit').disabled = false;
  }
}

/** Show the email field when this server sends email; the organizer's email is then required. */
function showConfig(update) {
  getConfig().then((c) => {
    if (!$('#notify-field')) return;
    $('#notify-field').hidden = !c.email;
    $('#notify-off').hidden = !!c.email;
    $('#notify').required = !!c.email;
    $('#notify').addEventListener('input', update);
    update();
  });
}
/** What's wrong with the organizer's email, if it's needed. */
function emailMissing() {
  const el = $('#notify');
  if (!el?.required) return '';
  const v = el.value.trim();
  return !v ? 'Add your email to create the poll' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Check your email address' : '';
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
const timeRange = shortRange;

export function renderPick() {
  document.title = 'Vote on a few dates · Venn';
  const src = source();
  editing = null;
  // The options so far, in local time: { date, from, to } in minutes, or { date, days } for all day or longer.
  const items = new Map();
  let length = 120;
  let spanDays = 3;
  let brush = YES; // new options are marked as working for the organizer, or only if needed
  let view = null; // the week / day picker, for options with times
  let month = null; // the month, for all-day options and trips

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
    setLength(o.length);
  });

  const timed = () => typeof length === 'number' || length === 'custom';
  const minutes = () => (length === 'custom' ? Math.max(15, Math.min(1440, +$('#custom').value || 60)) : length);
  const onDate = (d) => [...items.values()].filter((it) => it.date === d);
  const mark = (d) => (onDate(d).length ? String(onDate(d).length) : '');
  const ifNeeded = (it) => it.v === IF_NEEDED;
  const tripDays = (it) => it.days || spanDays;

  // ----- adding and removing options -----
  function add(it) {
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
        ? 'Tap the calendar to add an option of the length above. Drag its top or bottom edge to change the length. Tap an option to switch between available and if needed, or × to remove it.'
        : 'Drag on the calendar to add an option, or click to add one of the length above. Drag an edge to change the length, or drag it to another time. Click an option to switch between available and if needed, or × to remove it.';
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
              cls: ifNeeded(it) ? 'opt opt-maybe' : 'opt',
              label: `${ifNeeded(it) ? '~ ' : ''}${timeRange(it.from, it.to)}`,
              short: shortTime(it.from),
              title: `${timeRange(it.from, it.to)}, ${dayLabel(it.date)}, ${ifNeeded(it) ? 'if needed' : 'available'} for you. Tap to make it ${ifNeeded(it) ? 'available' : 'if needed'}`,
              remove: `Remove ${timeRange(it.from, it.to)}, ${dayLabel(it.date)}`,
            })),
        onCreate: (date, from, to) => add({ date, from, to }),
        onBlock: flip,
        onResize: (k, from, to) => reshape(k, items.get(k).date, from, to),
        onMove: reshape,
        editBlocks: (el, o) => editBlocks(el, { ...o, onRemove: remove }),
        marks: mark,
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
      box.innerHTML = `<p class="hint">Nothing yet. ${timed() ? 'Add times on the calendar above.' : 'Tap days on the calendar above.'} Everyone will say yes, if needed or no to each option you add.</p>`;
      return;
    }
    const removeBtn = (k, label) => `<button type="button" data-remove="${esc(k)}" aria-label="Remove ${esc(label)}">×</button>`;
    // The option's label switches it between available and if needed.
    const flipBtn = (k, it, label) =>
      `<button type="button" class="chip-flip" data-flip="${esc(k)}" aria-label="${esc(`${label}, ${ifNeeded(it) ? 'if needed' : 'available'} for you. Switch to ${ifNeeded(it) ? 'available' : 'if needed'}`)}">${ifNeeded(it) ? '~ ' : ''}${esc(itemLabel(it))}</button>`;
    let rows;
    if (length === 'days') {
      rows = list
        .map(
          ([k, it]) => `<li class="od-row">
            <span class="chip trip${ifNeeded(it) ? ' maybe' : ''}">${flipBtn(k, it, itemLabel(it))}${removeBtn(k, itemLabel(it))}</span>
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
                  `<span class="chip${ifNeeded(it) ? ' maybe' : ''}">${flipBtn(k, it, `${dayLabel(d)}, ${itemLabel(it)}`)}${removeBtn(k, `${dayLabel(d)}, ${itemLabel(it)}`)}</span>`,
              )
              .join('')}</span>
          </li>`,
        )
        .join('');
    }
    box.innerHTML = `<p class="preview-lede">Guests will choose from <b>${plural(list.length, 'option')}</b>. <span class="muted">~ means if needed for you.</span></p>
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
    if (!timed() && (rm || e.target.closest('#clear-options'))) mountPicker();
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
    // Keep the calendar (and the week it shows) when only the number of hours changes.
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
  $('#span').onchange = () => {
    $('#span').value = spanDays;
  };
  $('#custom').oninput = () => {
    for (const it of items.values()) if (it.from != null) it.to = Math.min(it.from + minutes(), 1440);
    changed();
  };

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
      !n
        ? 'Add at least one option to create the poll'
        : !named(occasion)
          ? 'Give your plan a name to create the poll'
          : emailMissing(),
      `${plural(n, 'option')} to vote on`,
    );
  }
  $('#title').addEventListener('input', updateReady);

  /** Start from an existing poll's options. */
  async function prefill() {
    const ev = await loadSource(src);
    if (!ev || ev.mode !== 'options' || !$('#create')) return;
    fillCommon(ev, src);
    const tz = ev.timezone;
    const spans = ev.options.map((o) => allDaySpan(o.start, o.end, tz));
    // Each option keeps the organizer's mark: available, or only if needed.
    const host = ev.participants.find((p) => p.id === ev.hostId);
    const mark = (start) => (host?.availability[start] === IF_NEEDED ? IF_NEEDED : YES);
    items.clear();
    if (spans.every(Boolean)) {
      const n = spans.map((sp) => Math.round((Date.parse(sp.endDate) - Date.parse(sp.startDate)) / 86_400_000));
      const trips = n.some((x) => x > 1);
      if (trips) $('#span').value = spanDays = n[0];
      setLength(trips ? 'days' : 'allday');
      spans.forEach((sp, i) =>
        items.set(`${sp.startDate}|day`, { date: sp.startDate, days: trips ? n[i] : 1, v: mark(ev.options[i].start) }),
      );
      mountPicker();
    } else {
      const preset = LENGTHS.some(([v]) => v === ev.durationMinutes);
      if (!preset) $('#custom').value = ev.durationMinutes;
      setLength(preset ? ev.durationMinutes : 'custom');
      for (const o of ev.options) {
        const z = utcToZoned(o.start, tz);
        items.set(`${z.date}|${z.minutes}`, {
          date: z.date,
          from: z.minutes,
          to: Math.min(z.minutes + (o.end - o.start) / MINUTE, 1440),
          v: mark(o.start),
        });
      }
      changed();
    }
    const first = sorted()[0]?.[1].date;
    if (first) (view || month)?.show(first);
    renderList();
  }

  setLength(120);
  showConfig(updateReady);
  getConfig().then((c) => $('#ai-draft') && ($('#ai-draft').hidden = !c.ai || !!src));
  if (src) prefill();
  else prefillTitle();
  $('#title').focus();
  return () => {
    view?.cleanup();
    month?.cleanup();
  };
}

// ---------- "Ask when people are free" ----------

const HOUR_LENGTHS = [30, 60, 90, 120, 180, 240];
// How detailed guests' answers are, from the broadest to the finest.
const LEVELS = [
  ['days', 'Whole days'],
  ['parts', 'Parts of the day'],
  ['hours', 'Hours'],
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
  const src = source();
  editing = null;
  // What's picked at each level. Zooming in or out carries it to the next level.
  const selected = new Set(); // days, for whole days
  const partsSel = new Set(); // "YYYY-MM-DD|<part start>", for parts of the day
  const painted = new Set(); // "YYYY-MM-DD|minutes", for hours
  let defaultParts = new Set(DAY_PARTS.map((p) => p.key)); // the parts a day gets when zooming in
  let level = 'days';
  let length = 120; // minutes, for hours
  let painter = null;
  let cal = null;

  app.innerHTML = `
    <form id="create" class="create" novalidate>
      <a class="back" href="/new" data-link>‹ Both kinds of poll</a>
      <h1>Ask when people are free</h1>
      ${planFields('free')}
      <section class="sheet" aria-labelledby="when-h">
        <h2 id="when-h">When could it be?</h2>
        <div class="zoom">
          <span class="scope-label" id="level-l">Guests answer with</span>
          <div class="seg" role="radiogroup" aria-labelledby="level-l">
            ${LEVELS.map(([k, l]) => `<button type="button" role="radio" data-level="${k}">${l}</button>`).join('')}
          </div>
        </div>
        <p class="hint" id="level-hint"></p>
        <div class="inline-field" data-for="days">
          <label for="span">How many days in a row do you need?</label>
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
    if (o.days) {
      $('#span').value = o.days;
      return setLevel('days');
    }
    if (typeof o.length === 'number') setLength(o.length);
    // Days picked from now on get the plan's usual part of the day.
    if (o.part) defaultParts = new Set([o.part]);
    update();
  });

  const span = () => Math.max(1, Math.min(MAX_SPAN_DAYS, +$('#span').value || 1));
  const datesOf = (keys) => [...new Set([...keys].map((k) => k.split('|')[0]))].sort();
  const paintedDates = () => datesOf(painted);
  // The part of the day a painted half hour belongs to (the gaps between parts go to the nearest).
  const partOfSlot = (m) => DAY_PARTS[m < 720 ? 0 : m < 1050 ? 1 : 2];
  const slots = (from, to) => Array.from({ length: (to - from) / 30 }, (_, i) => from + i * 30);
  const reset = (set, keys) => {
    set.clear();
    for (const k of keys) set.add(k);
  };

  /** Carry what's picked from one level to another. Zooming out keeps exactly the days (or parts)
   * that have something; zooming in keeps what's there and fills in days that have nothing yet. */
  function zoom(from, to) {
    if (!from || from === to) return;
    if (to === 'days') return reset(selected, from === 'parts' ? datesOf(partsSel) : paintedDates());
    if (from === 'hours')
      return reset(
        partsSel,
        [...painted].map((k) => `${k.split('|')[0]}|${partOfSlot(+k.split('|')[1]).start}`),
      );
    if (to === 'parts') {
      // From whole days: each day keeps its parts, and a new day gets the usual ones.
      const had = new Set(datesOf(partsSel));
      for (const k of [...partsSel]) if (!selected.has(k.split('|')[0])) partsSel.delete(k);
      for (const d of selected)
        if (!had.has(d)) for (const p of DAY_PARTS) if (defaultParts.has(p.key)) partsSel.add(`${d}|${p.start}`);
      return;
    }
    // Into hours: keep painted times in the parts (or days) still picked, and paint the rest whole.
    const keep = from === 'parts' ? (d, m) => partsSel.has(`${d}|${partOfSlot(m).start}`) : (d) => selected.has(d);
    for (const k of [...painted]) {
      const [d, m] = k.split('|');
      if (!keep(d, +m)) painted.delete(k);
    }
    const want =
      from === 'parts'
        ? [...partsSel].map((k) => {
            const [d, m] = k.split('|');
            const p = DAY_PARTS.find((x) => x.start === +m);
            return [d, p.start, p.end];
          })
        : [...selected].map((d) => [d, 480, 1380]);
    for (const [d, a, b] of want) {
      const ks = slots(a, b).map((m) => `${d}|${m}`);
      if (!ks.some((k) => painted.has(k))) for (const k of ks) painted.add(k);
    }
  }

  /** Zoom between whole days, parts of the day and hours. */
  function setLevel(next) {
    if (next === level && (painter || cal)) return;
    zoom(level, next);
    level = next;
    for (const b of $$('[data-level]')) b.setAttribute('aria-checked', b.dataset.level === level);
    for (const el of $$('[data-for]')) el.hidden = el.dataset.for !== level;
    $('#level-hint').textContent = {
      days: 'Guests tap the days they’re free. Start here: you can zoom in to parts of the day or hours.',
      parts: 'Guests tap the mornings, afternoons and evenings they’re free. Pick which ones to ask about on each day.',
      hours: 'Guests mark the hours they’re free, in 30-minute steps, within the times you paint.',
    }[level];
    mount();
    update();
  }
  function setLength(v) {
    length = v;
    for (const b of $$('[data-flength]')) b.setAttribute('aria-pressed', +b.dataset.flength === v);
  }

  function mount() {
    painter?.cleanup();
    cal?.cleanup();
    painter = cal = null;
    const root = $('#when');
    if (level === 'days') {
      cal = monthView(root, { selected, onChange: update });
      const first = [...selected].sort()[0];
      if (first) cal.show(first);
      $('#quick').innerHTML = `
        <button type="button" class="pill" id="q-2w">Next 2 weeks</button>
        <button type="button" class="pill" id="q-weekends">Next 4 weekends</button>
        <button type="button" class="pill pill-quiet" id="q-clear">Clear all</button>`;
      return;
    }
    const parts = level === 'parts';
    const set = parts ? partsSel : painted;
    painter = paintView(root, { selected: set, onChange: update, startAt: datesOf(set)[0], parts: parts && DAY_PARTS });
    const touch = isPhone();
    $('#quick').innerHTML = `<p class="hint pg-help">${
      parts
        ? `${touch ? 'Tap' : 'Click'} a morning, afternoon or evening to add it or take it away, or drag across several. ${touch ? 'Tap' : 'Click'} a day name for the whole day.`
        : touch
          ? 'Drag down the calendar to paint; start on a painted time to erase. Tap a day name for the whole day. Scroll with the times on the left.'
          : 'Drag across the calendar to paint; start on a painted time to erase. Click a day name for the whole day.'
    }</p><span class="scope-label">Fill this week:</span>${FILLS.map(
      ([l, a, b], i) =>
        `<button type="button" class="pill" data-fill="${i}">${l}${parts ? '' : ` <small>${esc(shortRange(a, b))}</small>`}</button>`,
    ).join('')}<button type="button" class="pill pill-quiet" id="q-clear">Clear all</button>`;
  }

  const fill = (n, keep) => {
    selected.clear();
    for (let d = todayStr(), i = 0; selected.size < n && i < 120; d = addDays(d, 1), i++)
      if (keep(dateParts(d).getUTCDay())) selected.add(d);
    cal.show(todayStr());
    update();
  };
  $('#create').addEventListener('click', (e) => {
    const lv = e.target.closest('[data-level]');
    if (lv) setLevel(lv.dataset.level);
    const l = e.target.closest('[data-flength]');
    if (l) {
      setLength(+l.dataset.flength);
      update();
    }
    const st = e.target.closest('[data-step]');
    if (st) {
      $('#span').value = Math.max(1, Math.min(MAX_SPAN_DAYS, span() + +st.dataset.step));
      update();
    }
    const f = e.target.closest('[data-fill]');
    if (f) {
      // That part of the day on every day of the week shown, or cleared if it's all there.
      const [, from, to] = FILLS[+f.dataset.fill];
      const set = level === 'parts' ? partsSel : painted;
      const mins =
        level === 'parts' ? DAY_PARTS.filter((p) => p.start >= from && p.start < to).map((p) => p.start) : slots(from, to);
      const keys = painter.week().flatMap((d) => mins.map((m) => `${d}|${m}`));
      const all = keys.every((k) => set.has(k));
      for (const k of keys) all ? set.delete(k) : set.add(k);
      painter.render();
      update();
    }
    if (e.target.closest('#q-2w')) fill(14, () => true);
    if (e.target.closest('#q-weekends')) fill(12, (wd) => wd === 5 || wd === 6 || wd === 0);
    if (e.target.closest('#q-clear')) {
      painted.clear();
      partsSel.clear();
      selected.clear();
      painter?.render();
      cal?.render();
      update();
    }
    const rm = e.target.closest('[data-rm-window]');
    if (rm) {
      const [ds, from, to] = rm.dataset.rmWindow.split('|');
      for (const d of ds.split(','))
        if (level === 'parts') partsSel.delete(`${d}|${from}`);
        else for (const m of slots(+from, +to)) painted.delete(`${d}|${m}`);
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
  // Typing 0 or 99 counts as the nearest number that works; show it.
  $('#span').onchange = () => {
    $('#span').value = span();
    update();
  };
  $('#title').addEventListener('input', update);

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
  const rmBtn = (attr, label) => `<button type="button" ${attr} aria-label="Remove ${esc(label)}">×</button>`;
  /** The parts of the day picked, as windows like painted hours: [{ date, start, end }]. */
  const partWindows = () =>
    [...partsSel]
      .map((k) => {
        const [date, m] = k.split('|');
        const p = DAY_PARTS.find((x) => x.start === +m);
        return { date, start: p.start, end: p.end };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const partLabel = (a, b) => `${DAY_PARTS.find((p) => p.start === a).label} ${shortRange(a, b)}`;

  /** The days (and times) guests will mark, grouped, each with a ×. */
  const windowList = (windows, label) =>
    `<ul class="od-list">${groups(windows)
      .map(
        (g) =>
          `<li class="od-row"><span class="od-date">${esc(dayRange(g.dates))}</span><span class="chips">${g.ranges
            .map(
              ([a, b]) =>
                `<span class="chip">${esc(label(a, b))}${rmBtn(`data-rm-window="${g.dates.join(',')}|${a}|${b}"`, `${dayRange(g.dates)}, ${label(a, b)}`)}</span>`,
            )
            .join('')}</span></li>`,
      )
      .join('')}</ul>`;

  // What guests will be able to mark, and whether the poll can be created yet.
  function update() {
    const box = $('#free-list');
    if (level === 'hours') {
      const windows = toWindows(painted);
      const dates = paintedDates();
      box.innerHTML = windows.length
        ? `<p class="preview-lede">Guests will mark when they’re free in these times. Venn looks for <b>${esc(lengthLabel(length))}</b> that works for the most people.</p>
          ${windowList(windows, shortRange)}`
        : '<p class="hint">Nothing yet. Paint some times on the calendar above, or use a quick fill.</p>';
      return setReady(
        !windows.length
          ? 'Paint at least one time to create the poll'
          : !windows.some((w) => w.end - w.start >= length)
            ? `Your times are shorter than ${lengthLabel(length)}. Paint a longer stretch`
            : !named(occasion)
              ? 'Give your plan a name to create the poll'
              : emailMissing(),
        `${plural(dates.length, 'day')} to choose from`,
      );
    }
    if (level === 'parts') {
      const windows = partWindows();
      box.innerHTML = windows.length
        ? `<p class="preview-lede">Guests will tap which of these they’re free.</p>${windowList(windows, partLabel)}`
        : '<p class="hint">Nothing yet. Tap mornings, afternoons and evenings on the calendar above, or use a quick fill.</p>';
      return setReady(
        !windows.length
          ? 'Pick at least one morning, afternoon or evening'
          : !named(occasion)
            ? 'Give your plan a name to create the poll'
            : emailMissing(),
        `${plural(windows.length, 'time')} to choose from`,
      );
    }
    const dates = [...selected].sort();
    const k = span();
    box.innerHTML = dates.length
      ? `<p class="preview-lede">On ${plural(dates.length, 'day')} (${esc(dayRange(dates))}), guests will mark the whole days they’re free. ${k > 1 ? `Venn looks for <b>${k} days in a row</b> that work for the most people.` : 'Venn finds the days the most people are free.'}</p><div class="chips">${dates
          .map((d) => `<span class="chip">${esc(dayLabel(d))}${rmBtn(`data-rm-day="${d}"`, dayLabel(d))}</span>`)
          .join('')}</div>`
      : '<p class="hint">Nothing yet. Pick some days on the calendar above.</p>';
    setReady(
      !dates.length
        ? 'Pick at least one day to create the poll'
        : k > dates.length
          ? `Pick at least ${k} days, for ${k} in a row`
          : longestRun(dates) < k
            ? `None of your days make ${k} in a row. Pick days next to each other`
            : !named(occasion)
              ? 'Give your plan a name to create the poll'
              : emailMissing(),
      `${plural(dates.length, 'day')} to choose from`,
    );
  }

  $('#create').onsubmit = (e) => {
    e.preventDefault();
    if ($('#submit').disabled) return;
    if (level === 'hours') return submit({ windows: toWindows(painted), slotMinutes: 30, durationMinutes: length }, occasion);
    if (level === 'parts') {
      const tz = $('#tz').value;
      const options = partWindows().map((w) => ({ start: zonedToUtc(w.date, w.start, tz), end: zonedToUtc(w.date, w.end, tz) }));
      return submit({ mode: 'options', layout: 'parts', options }, occasion);
    }
    const dates = [...selected].sort();
    submit({ dates, startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: span() * 1440 }, occasion);
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
    level = null; // show the level again, from the poll's days or times
    setLevel(next);
  }

  setLength(120);
  setLevel('days');
  showConfig(update);
  if (src) prefill();
  else prefillTitle();
  $('#title').focus();
  return () => {
    painter?.cleanup();
    cal?.cleanup();
  };
}
