// The create pages' shared parts. Every new poll is a Venn:
//   /new       You pick the days (and times) that could work; everyone marks theirs; Venn finds the overlap.
//   /new/pick  The older "vote on a few dates" page, for editing and copying polls made with it.

import { IF_NEEDED, YES, isEmail } from './core.js';
import { TEMPLATES, orderTemplates, templateIndex } from './templates.js';
import { $, $$, api, esc, save, toast, getConfig, lastEmail, lastName, localTz, rememberEmail, rememberName } from './ui.js';

// The create pages' own styles, so people answering a poll never download them. They load before
// the page is drawn, so it never shows unstyled.
await new Promise((done) =>
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/create.css', onload: done, onerror: done }),
  ),
);

// The organizer's on/off choices, and their switches in "Privacy options". The poll's look isn't
// one of them: a new poll takes the look the page is in (see pollLook below).
const PRIVACY = [
  ['requireEmail', '#p-email'],
  ['hideNames', '#p-names'],
  ['hideResults', '#p-results'],
];

// Kinds of plans (templates), with sensible defaults: see templates.js.
export const OCCASIONS = TEMPLATES;

// The landing page's "What are you planning?" box sends its text as ?title=, and a template page
// (/templates/friendsgiving) its template as ?template=. The form uses them.
const titleFromUrl = () => (new URLSearchParams(location.search).get('title') || '').trim().slice(0, 120);
const templateFromUrl = () => templateIndex(new URLSearchParams(location.search).get('template'));
// "Find a date for it", from a decided topic poll: ?where= fills Where, and ?after=<poll> makes the
// date poll follow on from it (seriesOf), so its group can be brought back.
let after = null;
export function prefillTitle() {
  const q = new URLSearchParams(location.search);
  const title = titleFromUrl();
  const t = templateFromUrl();
  linkFilled = !!(title || t >= 0 || q.get('where') || q.get('after'));
  if (t >= 0) $(`[data-occasion="${t}"]`)?.click(); // (a topic poll has no templates)
  if (title) $('#title').value = title;
  if (q.get('where')) $('#more-box').open = !!($('#location').value = q.get('where').slice(0, 200));
  after = /^[A-Za-z0-9]{1,32}$/.test(q.get('after') ?? '') ? q.get('after') : null;
  const from = fromUrl();
  const keep = new URLSearchParams([...(from ? [['from', from]] : []), ...(brandId ? [['brand', brandId]] : [])]);
  if (title || t >= 0) history.replaceState(null, '', location.pathname + (keep.size ? `?${keep}` : ''));
  if (brandId) useBrand(brandId, true);
}

// ---------- an organization's brand template (/brand) ----------

// ?brand=<id>: the poll is made from an organization's template, in its look, with what it starts
// with filled in. A copy of a branded poll keeps its brand too.
let brandId = null;
let brand = null;
const brandFromUrl = () => {
  const id = new URLSearchParams(location.search).get('brand');
  return /^[A-Za-z0-9]{1,32}$/.test(id ?? '') ? id : null;
};
/** Show the brand's look (brand-look.js), and for a new poll fill in what it starts with. */
async function useBrand(id, fill) {
  const [b, look] = await Promise.all([api(`brands/${id}`).catch(() => null), import('./brand-look.js')]);
  if (!b) return ((brandId = null), toast("That brand template doesn't exist any more. This poll is plain Venn."));
  if (brandId === id && $('#create')) look.brandForm((brand = b), fill, $, esc);
}

// ---------- editing or duplicating a poll ----------

// ?edit=<id> changes that poll (only while nobody else has answered); ?copy=<id> starts a new poll
// from it. The organizer tools on the poll page link here.
let editing = null; // the poll being changed, or null when creating one
/** A create page starts a new form: not editing anything yet. */
export function startForm() {
  editing = null;
  after = null;
  brand = null;
  brandId = brandFromUrl();
  // Coming from a branded poll, the page goes back to Venn's own look.
  if (!brandId && document.documentElement.classList.contains('branded'))
    import('./brand-look.js').then((m) => !brandId && m.brandLook(null));
}

export function source() {
  const q = new URLSearchParams(location.search);
  const id = q.get('edit') || q.get('copy');
  // Poll ids are letters and digits; anything else isn't a poll and must not reach the API path.
  return /^[A-Za-z0-9]+$/.test(id ?? '') && { id, edit: q.has('edit') };
}

let editPoll = null; // the code for editing and duplicating, loaded with the poll to start from
let icon = null; // the poll's own emoji or picture (poll-image.js), once the icon tile is tapped

/** The emoji picked for this poll ('' for the plan's own), and setting one, as AI does (ai-draft.js). */
export const iconEmoji = () => icon?.emoji() || '';
export async function setIconEmoji(e) {
  icon ??= await import('./poll-image.js');
  return icon.setEmoji(e);
}
/** The tile's emoji for the kind of plan (a vote starter's): one the organizer picked stays. */
export function planEmoji(e) {
  if (icon) icon.setBase(e);
  else $('#emoji-tile').textContent = e;
}
/** The tile's style ('' for plain), and setting one: never on a brand template's poll. */
export const iconBg = () => icon?.bg() || '';
export async function setIconBg(key) {
  if (brand) return false;
  icon ??= await import('./poll-image.js');
  icon.setBg(key);
  return true;
}

/** The poll to start from (see edit-poll.js), or null. */
export async function loadSource(src) {
  [editPoll, icon] = await Promise.all([import('./edit-poll.js'), import('./poll-image.js')]).catch(() => []);
  return editPoll?.loadSource(src) ?? null;
}
/** Fill in everything both kinds of poll share: the plan, the organizer and the privacy options. */
export function fillCommon(ev, src) {
  editPoll.fillCommon(ev, src, { occasions: OCCASIONS, privacy: PRIVACY, icon });
  if (ev.brand) useBrand((brandId = ev.brand.id), false);
  else import('./retro-look.js').then((m) => m.retroLook(ev.retro));
  if (src.edit) editing = src.id;
}

/** ?from=, for usage stats (src/usage.js). */
export const fromUrl = () => new URLSearchParams(location.search).get('from') || '';

// ---------- shared form parts ----------

// Required fields say so next to their label (screen readers hear aria-required instead).
const REQ = ' <span class="req" aria-hidden="true">Required</span>';
// Every poll starts with a name; a template renames it, and typing replaces it.
const SEED = 'Get-together';
/** The poll still has the name Venn gave it (data-seed). */
const seeded = () => $('#title').value === $('#title').dataset.seed;

/**
 * Which kind of Venn: find a date (/new) or vote on what or where (/new/topic). The same switch on
 * both forms, in the same place, so going between them feels like one page. A brand template stays.
 */
export function kindSwitch(on) {
  const brand = new URLSearchParams(location.search).get('brand');
  const q = brand ? `?brand=${encodeURIComponent(brand)}` : '';
  const link = (k, href, label) => `<a href="${href}${q}" data-link${k === on ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="seg kind-switch" aria-label="Kind of Venn">${link('date', '/new', '📅 Date')}${link('topic', '/new/topic', '🗳️ Vote')}</nav>`;
}

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
          <label for="title">Name of your poll</label>
          <input id="title" type="text" maxlength="120" value="${SEED}" data-seed="${SEED}" placeholder="${kind === 'free' ? 'Summer cabin trip' : "Dinner at Rosa's"}">
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
        <p class="hint" id="notify-hint">We'll email you the link and each answer.</p>
      </div>
      <p class="hint" id="notify-off" hidden>Email isn't switched on for this Venn server.</p>
      <details class="reveal" id="privacy-opts">
        <summary>Privacy options</summary>
        <label class="switch"><input type="checkbox" role="switch" id="p-email"> Ask guests for their email</label>
        <label class="switch"><input type="checkbox" role="switch" id="p-names"> Hide names from guests</label>
        <label class="switch"><input type="checkbox" role="switch" id="p-results"> Hide answers from guests</label>
      </details>
      <details class="reveal" id="invite-opts" hidden>
        <summary>Email it to people</summary>
        <div id="invite-box"></div>
      </details>
      <details class="reveal" id="deadline-opts" hidden>
        <summary>Deadline</summary>
        <div id="deadline-box"></div>
      </details>
    </section>`;
}

/** How to mark something "if needed": the same on every calendar, a second tap. */
export const TAP_KEY = `<p class="hint tap-key"><span><span class="swatch swatch-yes" aria-hidden="true"></span>Tap: available</span><span><span class="swatch swatch-maybe" aria-hidden="true"></span>Tap again: if needed</span></p>`;

/**
 * The time zone the times are in: this device's, always (everyone sees times in their own). No
 * choosing; an edited poll keeps the zone it was made in, so its times stay where they are.
 */
export const tzLine = () => `<input type="hidden" id="tz" value="${esc(localTz)}">`;

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
  // Address search (place-search.js), if switched on, loads when "Where" is first focused.
  const where = $('#location');
  const places = (c) => c.places && import('./place-search.js').then((m) => m.attach(where, c.places));
  where.addEventListener('focus', () => getConfig().then(places), { once: true });
  $('#create').addEventListener('click', async (e) => {
    if (e.target.closest('#emoji-tile'))
      return void import('./poll-image.js').then(
        (m) => (icon = m).toggle({ styles: !brand }),
        () => toast("Couldn't load that. Try again."),
      );
    const b = e.target.closest('[data-occasion]');
    if (!b) return;
    const quiet = fromDraft; // a draft put back brings its own note and title
    fromDraft = false;
    const o = OCCASIONS[+b.dataset.occasion];
    current = current === o ? null : o;
    for (const x of $$('[data-occasion]')) x.setAttribute('aria-pressed', x === b && !!current);
    // One out of season, from a link or a poll being edited, shows up front.
    if (b.hidden) b.parentElement.prepend(Object.assign(b, { hidden: false }));
    if (icon) icon.setOccasion(current);
    else $('#emoji-tile').textContent = current?.emoji || '🗓️';
    onOccasion(current);
    // A kind of plan also names it, unless the organizer did.
    const title = $('#title');
    if (seeded() || !title.value.trim()) title.value = title.dataset.seed = current?.label || SEED;
    title.dispatchEvent(new Event('input'));
    // Tapping the same template over and over gets noticed.
    taps = taps[0] === o ? [o, taps[1] + 1] : [o, 1];
    if (e.isTrusted && taps[1] > 4) egg('taps', o);
    if (quiet) return;
    // What it fills in (template-notes.js), unless another was chosen or a poll is edited.
    const notes = await import('./template-notes.js').catch(() => null);
    if (!notes || !$('#desc') || (o !== current && current)) return; // or the page has gone
    const fill = notes.prefill(current, $('#desc').value, noted);
    if (current) $('#title').placeholder = fill.title;
    $('#location').placeholder = fill.where;
    if (source() || fill.desc === $('#desc').value) return;
    $('#desc').value = noted = fill.desc;
    $('#more-box').open ||= !!noted;
  });
  $('#title').addEventListener('focus', () => seeded() && $('#title').select());
  $('#title').addEventListener('pointerup', () => seeded() && $('#title').select(), { once: true });
  let typing;
  $('#title').addEventListener('input', (e) => {
    clearTimeout(typing);
    if (e.isTrusted) typing = setTimeout(() => $('#title') && egg('title', $('#title').value), 700);
  });
  return () => current;
}

// ---------- a draft: a half-made poll survives a reload, Back and the Date / Vote switch ----------

let formDraft = null; // form-draft.js, loaded once the form is drawn (a new poll's form only)
let fromDraft = false; // a template tapped by a draft being put back: its note and name stay out
let linkFilled = false; // the form was filled in from a link (prefillTitle), so it keeps no draft
/** Forms call it as their picks change: the draft is kept once the change in hand is handled. */
export const draftChanged = () => formDraft?.changed();
/**
 * A new poll's form keeps a draft of itself in this tab (not an edit, a copy, a brand template's
 * poll or a form a link filled in). `own()` gives the form's own part; `putBack(draft)` restores it.
 */
export async function keepDraft(kind, own, putBack) {
  formDraft?.stop();
  if (source() || linkFilled || brandId) return;
  formDraft = await import('./form-draft.js').catch(() => null);
  return formDraft?.keep(kind, own, putBack, { privacy: PRIVACY, seeded, quietly: (v) => (fromDraft = v) });
}

/**
 * Create the poll (or save the changes to it). `answer` (option start → yes or if needed) is the
 * organizer's own answer, from how they marked each option, saved with the poll.
 */
export async function submit(body, occasion, answer = null) {
  $('#err').textContent = '';
  const title = $('#title').value.trim() || occasion()?.label || SEED;
  Object.assign(body, {
    title,
    location: $('#location').value.trim(),
    description: $('#desc').value.trim(),
    organizer: $('#organizer').value.trim(),
    timezone: $('#tz').value,
  });
  const emoji = icon?.emoji() || occasion()?.emoji || brand?.emoji;
  if (emoji) body.emoji = emoji;
  if (!brand && icon?.bg()) body.tile = icon.bg();
  for (const [key, el] of PRIVACY) body[key] = $(el).checked;
  // The look the page is in (an edit keeps the poll's own; a brand template's replaces it).
  if (!editing && !brand) body.retro = document.documentElement.classList.contains('retro');
  if (deadline && !$('#deadline-opts').hidden) Object.assign(body, deadline.values());
  // Who Venn emails the poll to (invite-fields.js).
  if (invites && !invites.into(body)) return;
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
  else if (after) body.seriesOf = after;
  if (fromUrl()) body.from = fromUrl();
  if (brand) body.brand = brand.id;
  // The celebration (and its picture) load while the poll is saved.
  const celebration = import('./celebrate.js').catch(() => null);
  const invite = import('./invite.js').catch(() => null);
  try {
    const { id, adminToken, participant } = await api('events', { method: 'POST', body });
    const picture = icon?.upload(id, adminToken, title); // the poll's own picture, while the party plays
    formDraft?.drop(); // made: the next /new starts fresh
    save(id, {
      adminToken,
      justCreated: true,
      notifyPending: !!notifyEmail,
      ...(participant && { participantId: participant.id, editToken: participant.editToken }),
    });
    // A little party, while the poll page loads behind it.
    import('./event.js').catch(() => {});
    // The main button copies the link; on phones, Share opens the share sheet.
    const url = `${location.origin}/e/${id}`;
    let copying = null; // the link being copied, so its toast can show once the poll is open
    const text = (await invite)?.inviteText({ ...body, pick: body.mode === 'options' && body.layout !== 'parts' });
    const share = () =>
      (copying = navigator.clipboard.writeText(url).then(
        () => true,
        () => false,
      ));
    const sheet =
      navigator.share && matchMedia('(pointer: coarse)').matches
        ? () => navigator.share({ title, text, url }).catch(() => {})
        : null;
    // The next one of a plan: also one tap to email last time's group.
    const also = body.seriesOf ? editPoll?.inviteLast(url, title) : null;
    const party = (await celebration)?.celebrate({
      emoji: icon?.picture() ? '🎉' : body.emoji,
      picture: icon?.picture(),
      title,
      share,
      sheet,
      also,
    });
    await party?.shown;
    await picture;
    history.pushState(null, '', `/e/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
    scrollTo(0, 0);
    party?.finish();
    // Opening the poll clears any toast, so say the link was copied after it.
    if (copying) (await copying) ? toast('Invite link copied. Paste it in your group chat.') : prompt('Copy this:', url);
    else invites?.done(body);
  } catch (ex) {
    $('#err').textContent = ex.message;
    $('#submit').disabled = false;
  }
}

let deadline = null; // deadline-fields.js, for organizers who are signed in
let invites = null; // invite-fields.js, the same

/** Show the email field when this server sends email; the organizer's email is then required. */
export function showConfig(update) {
  tried = false;
  deadline = null;
  invites = null;
  // Each thing still needed, named in the sticky bar, goes to its field.
  $('#summary').onclick = (e) => {
    const b = e.target.closest('[data-need]');
    if (b && notReady) go(notReady.bad[b.dataset.need][2]);
  };
  $('#organizer').addEventListener('input', update);
  // A new poll's look: the page's, or a brand template's (create-look.js). An edit or copy keeps its own.
  if (!source())
    import('./create-look.js')
      .then((m) => m.createLook({ current: () => brandId, preview: () => icon?.preview() }))
      .catch(() => {});
  // A deadline, and reminders to who hasn't answered (deadline-fields.js): with an account, where
  // the server has sign-in. Signed out, the form stays as it is. An edited poll's deadline is
  // changed in its organizer tools.
  const opts = $('#deadline-opts');
  if (opts && !source()?.edit)
    getConfig().then(async (c) => {
      if ((c.accounts || []).length && !(await import('./account-menu.js')).accountHint()) return;
      const [m, inv] = await Promise.all([
        import('./deadline-fields.js').catch(() => null),
        c.email ? import('./invite-fields.js').catch(() => null) : null,
      ]);
      // Only into this form, still on the page (not a poll opened since).
      if (!m || deadline || !opts.isConnected) return;
      deadline = m;
      $('#deadline-box', opts).innerHTML = m.fields({}, { email: !!c.email });
      m.wire();
      opts.hidden = false;
      invites = inv?.onCreate(m);
    });
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
/** The form's own checks: the organizer's name and (when it's needed) email. */
export const nameAndEmail = () => [
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
