// The create pages' shared parts. There are two quite different polls (the chooser, chooser.js, offers both):
//   /new/pick  You suggest some dates (and times). Everyone votes on each one.
//   /new/free  You pick a range of days. Everyone marks when they're available; Venn finds the overlap.

import { IF_NEEDED, YES, isEmail } from './core.js';
import { TEMPLATES, orderTemplates, templateIndex } from './templates.js';
import {
  $,
  $$,
  api,
  esc,
  getConfig,
  lastEmail,
  lastName,
  localTz,
  rememberEmail,
  rememberName,
  save,
  toast,
  tzName,
  tzOptions,
} from './ui.js';

// The create pages' own styles, so people answering a poll never download them. They load before
// the page is drawn, so it never shows unstyled.
await new Promise((done) =>
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/create.css', onload: done, onerror: done }),
  ),
);

// The organizer's privacy choices, and their switches in "Privacy options".
const PRIVACY = [
  ['requireEmail', '#p-email'],
  ['hideNames', '#p-names'],
  ['hideResults', '#p-results'],
];

// Kinds of plans (templates), with sensible defaults: see templates.js.
export const OCCASIONS = TEMPLATES;

// The landing page's "What are you planning?" box sends its text as ?title=, and a template page
// (/templates/friendsgiving) its template as ?template=. The chooser passes them on; the form uses them.
const titleFromUrl = () => (new URLSearchParams(location.search).get('title') || '').trim().slice(0, 120);
const templateFromUrl = () => templateIndex(new URLSearchParams(location.search).get('template'));
export function prefillTitle() {
  const title = titleFromUrl();
  const t = templateFromUrl();
  if (t >= 0) $(`[data-occasion="${t}"]`).click();
  if (title) $('#title').value = title;
  const from = fromUrl();
  if (title || t >= 0) history.replaceState(null, '', location.pathname + (from ? `?from=${encodeURIComponent(from)}` : ''));
}

// ---------- editing or duplicating a poll ----------

// ?edit=<id> changes that poll (only while nobody else has answered); ?copy=<id> starts a new poll
// from it. The organizer tools on the poll page link here.
let editing = null; // the poll being changed, or null when creating one
/** A create page starts a new form: not editing anything yet. */
export const startForm = () => (editing = null);

export function source() {
  const q = new URLSearchParams(location.search);
  const id = q.get('edit') || q.get('copy');
  // Poll ids are letters and digits; anything else isn't a poll and must not reach the API path.
  return /^[A-Za-z0-9]+$/.test(id ?? '') && { id, edit: q.has('edit') };
}

let editPoll = null; // the code for editing and duplicating, loaded with the poll to start from
let icon = null; // the poll's own emoji or picture (poll-image.js), once the icon tile is tapped

/** The poll to start from (see edit-poll.js), or null. */
export async function loadSource(src) {
  [editPoll, icon] = await Promise.all([import('./edit-poll.js'), import('./poll-image.js')]).catch(() => []);
  return editPoll?.loadSource(src) ?? null;
}
/** Fill in everything both kinds of poll share: the plan, the organizer and the privacy options. */
export function fillCommon(ev, src) {
  editPoll.fillCommon(ev, src, { occasions: OCCASIONS, privacy: PRIVACY, showTz, icon });
  if (src.edit) editing = src.id;
}

/** ?from=, for usage stats (src/usage.js). */
export const fromUrl = () => new URLSearchParams(location.search).get('from') || '';

// ---------- shared form parts ----------

// Required fields say so next to their label (screen readers hear aria-required instead).
const REQ = ' <span class="req" aria-hidden="true">Required</span>';

export function planFields(kind) {
  // Templates as a row of cards to scroll: what's in season first (see templates.js).
  return `
    <section class="sheet" aria-labelledby="plan-h">
      <h2 id="plan-h">What's the plan?</h2>
      <div class="occasions templates" role="group" aria-label="Templates">
        ${orderTemplates(kind)
          .map(
            ([i, hidden]) =>
              `<button type="button" class="pill tpl" data-occasion="${i}" aria-pressed="false"${hidden ? ' hidden' : ''}><span class="tpl-emoji" aria-hidden="true">${OCCASIONS[i].emoji}</span>${esc(OCCASIONS[i].label)}</button>`,
          )
          .join('')}
      </div>
      <div class="title-row">
        <button type="button" class="emoji-tile" id="emoji-tile" aria-label="Change the icon" aria-expanded="false">🗓️</button>
        <div class="grow">
          <label for="title">Name of your poll${REQ}</label>
          <input id="title" type="text" maxlength="120" placeholder="${kind === 'free' ? 'Summer cabin trip' : "Dinner at Rosa's"}" aria-required="true">
        </div>
      </div>
      <details class="reveal" id="more-box">
        <summary>More details</summary>
        <label for="location">Where</label>
        <input id="location" type="text" maxlength="200" placeholder="A place, an address or a video link">
        <label for="desc">Note for everyone</label>
        <textarea id="desc" maxlength="1000" placeholder="What to bring, who's cooking, the plan for the day"></textarea>
      </details>
    </section>`;
}

export function youFields() {
  return `
    <section class="sheet" aria-labelledby="you-h">
      <h2 id="you-h">About you</h2>
      <div>
        <label for="organizer">Your name${REQ}</label>
        <input id="organizer" type="text" maxlength="80" autocomplete="name" value="${esc(lastName())}" placeholder="So people know who's asking" aria-required="true">
      </div>
      <div id="notify-field" hidden>
        <label for="notify">Your email${REQ}</label>
        <input id="notify" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${esc(lastEmail())}" aria-required="true" aria-describedby="notify-hint">
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
    </section>`;
}

/** How to mark something "if needed": the same on every calendar, a second tap. */
export const TAP_KEY = `<p class="hint tap-key"><span><span class="swatch swatch-yes" aria-hidden="true"></span>Tap: available</span><span><span class="swatch swatch-maybe" aria-hidden="true"></span>Tap again: if needed</span></p>`;

/** Once, after the first thing is picked, the same tip where people are looking. */
export function ifNeededTip() {
  try {
    if (localStorage.getItem('venn:tip-maybe')) return;
    localStorage.setItem('venn:tip-maybe', '1');
  } catch {
    return;
  }
  toast('Tip: tap it again to make it “if needed”.');
}

/** The time zone the times are in, under the calendar, with a way to change it. */
export const tzLine = () => `
  <details class="reveal tz-line" id="tz-box">
    <summary><span>Times in <span id="tz-name">${esc(tzName(localTz))}</span> · Change</span></summary>
    <label for="tz">Time zone for this poll</label>
    <select id="tz" aria-describedby="tz-hint">${tzOptions(localTz)}</select>
    <p class="hint" id="tz-hint">Everyone sees the times in their own time zone.</p>
  </details>`;
const showTz = () => ($('#tz-name').textContent = tzName($('#tz').value));

/** New picks are available for the organizer; switched on, if needed instead, to mark many at once. */
export const brushBox = () => `
  <details class="reveal tz-line" id="brush-box">
    <summary><span>Mark many as if needed</span></summary>
    <label class="switch"><input type="checkbox" role="switch" id="brush"> New ones are if needed for you</label>
  </details>`;
export const brush = () => ($('#brush')?.checked ? IF_NEEDED : YES);

// A few little surprises (easter-eggs.js), loaded the first time someone types a name or taps a
// template several times, never before.
let eggs = null;
const egg = (...args) => (eggs ??= import('./easter-eggs.js').catch(() => null)).then((m) => m?.react(toast, ...args));

/** Wire up the plan fields: templates fill in sensible defaults. */
export function wirePlan(onOccasion) {
  let current = null;
  let noted = ''; // the note a template put in "Note for everyone", so another can take it back
  let taps = [];
  $('#tz').addEventListener('change', showTz);
  $('#create').addEventListener('click', async (e) => {
    if (e.target.closest('#emoji-tile'))
      return void import('./poll-image.js').then(
        (m) => (icon = m).toggle(),
        () => toast("Couldn't load that. Try again."),
      );
    const b = e.target.closest('[data-occasion]');
    if (!b) return;
    const o = OCCASIONS[+b.dataset.occasion];
    current = current === o ? null : o;
    for (const x of $$('[data-occasion]')) x.setAttribute('aria-pressed', x === b && !!current);
    // One out of season, from a link or a poll being edited, shows up front.
    if (b.hidden) b.parentElement.prepend(Object.assign(b, { hidden: false }));
    if (icon) icon.setOccasion(current);
    else $('#emoji-tile').textContent = current?.emoji || '🗓️';
    onOccasion(current);
    $('#title').dispatchEvent(new Event('input')); // a kind of plan also names it
    // Tapping the same template over and over gets noticed.
    taps = taps[0] === o ? [o, taps[1] + 1] : [o, 1];
    if (e.isTrusted && taps[1] > 4) egg('taps', o);
    // What it fills in (template-notes.js), unless another was chosen meanwhile or a poll is being edited.
    const notes = await import('./template-notes.js').catch(() => null);
    if (!notes || !$('#desc') || (o !== current && current)) return; // or the page has gone
    const fill = notes.prefill(current, $('#desc').value, noted);
    if (current) $('#title').placeholder = fill.title;
    $('#location').placeholder = fill.where;
    if (source() || fill.desc === $('#desc').value) return;
    $('#desc').value = noted = fill.desc;
    $('#more-box').open ||= !!noted;
  });
  let typing;
  $('#title').addEventListener('input', (e) => {
    clearTimeout(typing);
    if (e.isTrusted) typing = setTimeout(() => $('#title') && egg('title', $('#title').value), 700);
  });
  return () => current;
}

/**
 * Create the poll (or save the changes to it). `answer` (option start → yes or if needed) is the
 * organizer's own answer, from how they marked each option, saved with the poll.
 */
export async function submit(body, occasion, answer = null) {
  $('#err').textContent = '';
  const title = $('#title').value.trim() || occasion()?.label || '';
  Object.assign(body, {
    title,
    location: $('#location').value.trim(),
    description: $('#desc').value.trim(),
    organizer: $('#organizer').value.trim(),
    timezone: $('#tz').value,
  });
  const emoji = icon?.emoji() || occasion()?.emoji;
  if (emoji) body.emoji = emoji;
  for (const [key, el] of PRIVACY) body[key] = $(el).checked;
  const notifyEmail = !$('#notify-field') || $('#notify-field').hidden ? '' : $('#notify').value.trim();
  if (notifyEmail) body.notifyEmail = notifyEmail;
  if (body.organizer) rememberName(body.organizer);
  if (notifyEmail) rememberEmail(notifyEmail);
  $('#submit').disabled = true;
  // The organizer's own answer: what they marked for each option, or yes to all the times offered.
  if (answer && Object.keys(answer).length) body.hostAvailability = answer;
  if (editing) return editPoll.saveEdit(editing, body, icon);
  body.hostAnswers = true;
  // A copy; the next one of a plan also says which poll it follows on from.
  if (source()) Object.assign(body, { copied: true }, editPoll?.seriesFields());
  if (fromUrl()) body.from = fromUrl();
  // The celebration (and its picture) load while the poll is saved.
  const celebration = import('./celebrate.js').catch(() => null);
  try {
    const { id, adminToken, participant } = await api('events', { method: 'POST', body });
    const picture = icon?.upload(id, adminToken, title); // the poll's own picture, while the party plays
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
      if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title, url }).catch(() => {});
      else
        copying = navigator.clipboard.writeText(url).then(
          () => true,
          () => false,
        );
    };
    // The next one of a plan: also one tap to email last time's group.
    const also = body.seriesOf ? editPoll?.inviteLast(url, title) : null;
    const party = (await celebration)?.celebrate({ emoji: body.emoji, picture: icon?.picture(), title, share, also });
    await party?.shown;
    await picture;
    history.pushState(null, '', `/e/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
    scrollTo(0, 0);
    party?.finish();
    // Opening the poll clears any toast, so say the link was copied after it.
    if (copying) (await copying) ? toast('Invite link copied. Paste it in your group chat.') : prompt('Copy this:', url);
  } catch (ex) {
    $('#err').textContent = ex.message;
    $('#submit').disabled = false;
  }
}

/** Show the email field when this server sends email; the organizer's email is then required. */
export function showConfig(update) {
  tried = false;
  // Each thing still needed, named in the sticky bar, goes to its field.
  $('#summary').onclick = (e) => {
    const b = e.target.closest('[data-need]');
    if (b && notReady) go(notReady.bad[b.dataset.need][2]);
  };
  $('#organizer').addEventListener('input', update);
  getConfig().then((c) => {
    if (!$('#notify-field')) return;
    $('#notify-field').hidden = !c.email;
    $('#notify-off').hidden = !!c.email;
    $('#notify').required = !!c.email;
    $('#notify').addEventListener('input', update);
    update();
  });
}
/** What's wrong with the organizer's email, if it's needed: the same rule the server checks. */
function emailMissing() {
  const el = $('#notify');
  if (!el?.required) return '';
  const v = el.value.trim();
  return !v ? 'Add your email' : !isEmail(v) ? 'Check your email address' : '';
}

/** A message under a field that's missing or wrong, tied to it for screen readers; '' clears it. */
function flag(el, message) {
  const id = `${el.id}-err`;
  let p = $(`#${id}`);
  const ids = (el.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== id);
  if (message) {
    if (!p) el.after((p = Object.assign(document.createElement('p'), { id, className: 'field-err' })));
    p.textContent = message;
    ids.unshift(id);
    el.setAttribute('aria-invalid', 'true');
  } else {
    p?.remove();
    el.removeAttribute('aria-invalid');
  }
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
}

/**
 * Show Create as not ready until the poll can be made, and say what's still missing. It stays a
 * working button (aria-disabled), so keyboard and screen-reader users can reach it and press it to
 * hear why. `checks` are [problem?, message, what to focus, message under the field, short name],
 * in the order of the page: the poll's name first, the organizer's name and email last. One problem
 * is said in full; several by name ("Needed: poll name · options · your name"). Each is a
 * button that goes to its field.
 */
let notReady = null; // { key, bad, checks } while something is missing
let tried = false; // Create was pressed: missing fields say so under them, until they're filled in
export function setReady(ready, ...checks) {
  checks.sort((a, b) => (b[2] === '#title') - (a[2] === '#title'));
  const bad = checks.filter(([x]) => x);
  const key = bad.map((c) => c[1]).join();
  if (key !== notReady?.key) $('#err').textContent = '';
  notReady = bad.length ? { key, bad, checks } : null;
  markFields(checks);
  $('#submit').setAttribute('aria-disabled', String(!!notReady));
  $('#submit').classList.toggle('not-ready', !!notReady);
  const need = (i, text) => `<button type="button" class="link-btn" data-need="${i}">${esc(text)}</button>`;
  const html = !bad.length ? esc(ready) : bad[1] ? `Needed: ${bad.map((c, i) => need(i, c[4])).join(' · ')}` : need(0, bad[0][1]);
  // Only when it changes, so screen readers don't hear it again with every key pressed.
  if (!$('#err').textContent && $('#summary').innerHTML !== html) $('#summary').innerHTML = html;
  $('#summary').classList.toggle('missing', !!notReady);
}
const markFields = (checks) => {
  for (const [x, , el, under] of checks) if (under != null && $(el)) flag($(el), tried && x ? under : '');
};
/** Go to what's missing: focus it, in the middle of the screen, clear of the sticky bar. */
function go(focus) {
  const el = typeof focus === 'function' ? focus() : $(focus);
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: 'center' });
}
/** Create was pressed before the poll is ready: say what's missing, mark each field, and go to the first. */
export function explainNotReady() {
  if (!notReady) return false;
  tried = true;
  const [[, message, focus]] = notReady.bad;
  markFields(notReady.checks);
  $('#summary').textContent = '';
  $('#err').textContent = message;
  go(focus);
  return true;
}
export const named = (occasion) => !!($('#title').value.trim() || occasion()?.label);
/** The form's own checks: the poll's name, then the organizer's name and (when it's needed) email. */
export const nameAndEmail = (occasion) => [
  [!named(occasion), 'Give your poll a name to create the poll', '#title', 'Give your poll a name', 'name'],
  [!$('#organizer').value.trim(), 'Add your name to create the poll', '#organizer', 'Add your name', 'your name'],
  [
    !!emailMissing(),
    `${emailMissing()}${emailMissing() === 'Add your email' ? ' to create the poll' : ''}`,
    '#notify',
    emailMissing(),
    'email',
  ],
];

export const createBar = (label) => `
  <div class="create-bar">
    <div class="create-sum">
      <span id="summary" aria-live="polite"></span>
      <span class="error" id="err" role="alert"></span>
    </div>
    <button class="btn btn-primary btn-lg" type="submit" id="submit">${esc(label)}</button>
  </div>`;
