// "Use AI": describe it, and AI fills it in. On "Create a Venn" (/new and /new/topic) one box above
// Date · Vote takes what the plan is, and Venn picks the kind (src/ask-kind.js): the days on the
// calendar, or a vote's question and options, moving to the other form when it needs to. On "vote
// on a few dates" it fills in the form, and on a brand template's "Starting look" it suggests the
// colours, fonts and shape. AI is optional: without it, the box on /new reads plain words itself
// (src/days-parse.js), and /new/topic has no box.

import { DAY_PARTS, LIMITS, MINUTE } from './core.js';
import { $, $$, api, esc, plural, reducedMotion, toast, track } from './ui.js';

import { aiFailed, aiHeaders, keyHint } from './ai-key.js';
import { describeDraft } from './draft-summary.js';
import { formDraftHasWork, formDraftKey, cleanFormDraft, readStored } from './drafts.js';

const keyProblem = (ex) => ex.status === 402 || (ex.status === 400 && /key/i.test(ex.message));

// The "Use AI" button: a pill with a gradient edge and a sparkle, beside a section's heading. Its
// look lives here, since only pages with AI on ever load it.
document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
  .ai-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
  /* The heading keeps one line: when the pill doesn't fit beside it, the pill goes under it. */
  .ai-head > h2 { margin-bottom: 0; flex: 1 0 auto; max-width: 100%; }
  .ai-head > .ai-use { flex: none; }
  .ai-draft .ai-use { justify-content: center; padding: 0 18px; }
  .ai-head + * { margin-top: 12px; }
  .ai-use {
    --ai-a: var(--accent); --ai-b: #7c5cff;
    display: inline-flex; align-items: center; gap: 7px; min-height: 44px; padding: 0 16px 0 13px;
    font: inherit; font-weight: 650; font-size: 0.95rem; letter-spacing: 0.01em; color: var(--text); cursor: pointer;
    border: 1.5px solid transparent; border-radius: 999px;
    background: linear-gradient(var(--surface), var(--surface)) padding-box,
      linear-gradient(120deg, var(--ai-a), var(--ai-b), var(--ai-a)) border-box;
    background-size: 100% 100%, 200% 100%;
    box-shadow: 0 1px 10px -4px var(--ai-b);
    transition: background-position 0.6s ease, box-shadow 0.2s ease, transform 0.15s ease;
  }
  .ai-use:hover { background-position: 0 0, 100% 0; box-shadow: 0 2px 16px -4px var(--ai-b); }
  .ai-use:active { transform: scale(0.98); }
  .ai-use[aria-expanded='true'] {
    background: linear-gradient(120deg, color-mix(in srgb, var(--ai-a) 14%, var(--surface)), color-mix(in srgb, var(--ai-b) 14%, var(--surface))) padding-box,
      linear-gradient(120deg, var(--ai-a), var(--ai-b)) border-box;
  }
  .ai-use svg { width: 18px; height: 18px; flex: none; }
  .ai-use .ai-star { transform-origin: center; transform-box: fill-box; animation: ai-twinkle 2.8s ease-in-out 0.4s 2; }
  @keyframes ai-twinkle { 0%, 100% { transform: scale(1) rotate(0); } 50% { transform: scale(1.18) rotate(12deg); } }
  @media (prefers-color-scheme: dark) { .ai-use { --ai-b: #a68bff; } }
  /* The one box above Date · Vote: closed, a quiet line that looks like an empty field. */
  .ask { margin: 0 0 16px; }
  .white-label .ask { display: none; }
  .ask-bar { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 0 14px;
    font: inherit; font-size: 16px; text-align: start; color: var(--muted); cursor: text;
    background: var(--surface); border: 1.5px solid var(--border); border-radius: 12px; }
  .ask-bar:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
  .ask-bar:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .ask-bar .ask-spark { color: var(--accent); font-size: 1.05rem; }
  .ask .ai-draft > label { font-weight: 650; }
  .ask .ai-row { display: grid; gap: 10px; }
  .ask .ai-row textarea { min-height: 0; }
  .ask .ai-go-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
  .ask .ai-go-row .hint { flex: 1 1 16em; margin: 0; }
  .ask .ai-go-row .link-btn { min-height: 44px; padding: 0 10px; }
  .ask .ai-done { margin-top: 10px; }
  .ask .ai-done > p:focus { outline: none; }
  .ask .ai-done .ai-kind { display: block; }
  .ask .ai-done .ai-kind + .ai-done-head { font-weight: 500; }
  .ask .ai-row .ai-use { justify-self: end; padding: 0 22px; }
  @media (max-width: 599px) { .ask .ai-row .ai-use { justify-self: stretch; } }
  .ai-wait { display: flex; align-items: center; gap: 10px; margin: 8px 0 0; font-weight: 600; }
  .ai-wait img { width: 40px; height: 40px; object-fit: contain; animation: ai-bob 0.9s ease-in-out infinite alternate; }
  @keyframes ai-bob { to { transform: translateY(-3px) rotate(-5deg); } }
  .ai-done { display: flex; flex-wrap: wrap; align-items: center; gap: 0 12px; margin: 12px 0 0; padding: 4px 6px 4px 14px;
    border-radius: 14px; background: color-mix(in srgb, #7c5cff 10%, var(--surface)); font-weight: 600; }
  .ai-done > p { flex: 1 1 12em; margin: 0; padding: 8px 0; overflow-wrap: anywhere; }
  .ai-done-head, .ai-done-when, .ai-done-note { display: block; }
  .ai-done-when { font-weight: 500; }
  .ai-done-note { margin-top: 2px; font-weight: 500; color: var(--muted); }
  .ai-done .link-btn { min-height: 44px; padding: 0 10px; }
  /* The last draft, under words that couldn't be read: still what's picked, but not their result.
     Dimmed with the muted colour and a fainter tint, not opacity, so its text keeps AA contrast; Undo as before. */
  .ai-done.stale { background: color-mix(in srgb, #7c5cff 4%, var(--surface)); }
  .ai-done.stale > p { color: var(--muted); }
  .ai-done-kicker { display: block; font-size: 0.8rem; font-weight: 600; color: var(--muted); }
  .ai-by-hand .link-btn { min-height: 0; padding-block: 12px; margin-block: -12px; }
  /* What AI filled in lights up, a field at a time, then the picked days in order. */
  .ai-lit { animation: ai-lit 1.4s ease-out both; animation-delay: calc(var(--ai-i, 0) * 70ms); }
  @keyframes ai-lit {
    0% { box-shadow: 0 0 0 0 rgb(124 92 255 / 0); }
    25% { box-shadow: 0 0 0 4px rgb(124 92 255 / 0.55); }
    100% { box-shadow: 0 0 0 10px rgb(124 92 255 / 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .ai-use, .ai-use .ai-star, .ai-wait img { transition: none; animation: none; }
    .ai-lit { animation: none; outline: 2px solid #7c5cff; outline-offset: 2px; }
  }
  </style>`,
);

const SPARKLE = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <defs><linearGradient id="ai-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>
    <path class="ai-star" fill="url(#ai-grad)" d="M10 2.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5Z"/>
    <path fill="url(#ai-grad)" d="M18 13c.3 2.2 1.3 3.2 3.5 3.5-2.2.3-3.2 1.3-3.5 3.5-.3-2.2-1.3-3.2-3.5-3.5 2.2-.3 3.2-1.3 3.5-3.5Z"/>
  </svg>`;

/**
 * "Use AI" beside the section heading `h2`, opening the AI box (put in after it, hidden at first).
 * Returns the box.
 */
function useAiButton(h2, boxHtml, label = `${SPARKLE}Use AI`) {
  const head = document.createElement('div');
  head.className = 'ai-head';
  h2.before(head);
  head.append(h2);
  head.insertAdjacentHTML(
    'beforeend',
    `<button type="button" class="ai-use" id="ai-open" aria-expanded="false" aria-controls="ai-draft">${label}</button>`,
  );
  head.insertAdjacentHTML('afterend', boxHtml);
  const panel = $('#ai-draft');
  panel.hidden = true;
  $('#ai-open').onclick = () => {
    panel.hidden = !panel.hidden;
    $('#ai-open').setAttribute('aria-expanded', !panel.hidden);
    if (!panel.hidden) $('#ai-prompt').focus();
  };
  return panel;
}

/** Close the box once AI has filled things in. */
function closeBox() {
  $('#ai-draft').hidden = true;
  $('#ai-open')?.setAttribute('aria-expanded', false);
  if ($('.ask-bar')) $('.ask-bar').hidden = false;
}

/** Show what AI changed: each element lights up in turn, then settles. */
function light(els) {
  els.filter(Boolean).forEach((el, i) => {
    el.classList.remove('ai-lit');
    el.style.setProperty('--ai-i', Math.min(i, 30));
    void el.offsetWidth; // start again if it was lit before
    el.classList.add('ai-lit');
    setTimeout(() => el.classList.remove('ai-lit'), 1600 + Math.min(i, 30) * 70);
  });
}

/**
 * Under the box, what AI did, with Undo, which puts the form back as it was. `said` is a line, or
 * { head, when, note }: the name, the dates and times it picked, and what it assumed.
 */
function done(said, undo) {
  $('#ai-done')?.remove();
  const { kind, head, when, note } = typeof said === 'string' ? { head: said } : said;
  const lines = [
    kind && `<b class="ai-kind">${esc(kind)}</b>`,
    head && (kind ? `<span class="ai-done-head">${esc(head)}</span>` : `<b class="ai-done-head">${esc(head)}</b>`),
    when && `<span class="ai-done-when">${esc(when)}</span>`,
    note && `<small class="ai-done-note">${esc(note)}</small>`,
  ].filter(Boolean);
  const where = $('#ask') || $('#ai-draft');
  where.insertAdjacentHTML(
    where.id === 'ask' ? 'beforeend' : 'afterend',
    `<div class="ai-done" id="ai-done" role="status"><p>${lines.join(' ')}</p><button type="button" class="link-btn" id="ai-undo">Undo</button></div>`,
  );
  $('#ai-undo').onclick = async () => {
    await undo();
    $('#ai-done')?.remove();
    unstale();
    (($('#ai-open')?.hidden ? null : $('#ai-open')) || $('#ai-prompt') || $('#title'))?.focus();
    toast('Put back as it was.');
  };
  $('#ai-done').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: $('#ask') ? 'nearest' : 'center' });
}

const STILL = 'Your last draft is still below, unchanged.';

/**
 * A fill was refused with `message`: say so in the box, and when an earlier draft (with Undo) is
 * showing, say it's still there and mark it as the last one, so it isn't read as the new words' result.
 */
function refused(message) {
  const card = $('#ai-done');
  const last = !!card?.querySelector('#ai-undo');
  $('#ai-err').textContent = last ? `${message} ${STILL}` : message;
  if (!last || card.classList.contains('stale')) return;
  card.classList.add('stale');
  card.querySelector('p').insertAdjacentHTML('afterbegin', '<small class="ai-done-kicker">Last draft</small>');
}

/** On Undo: the refusal no longer says the draft is still below (the card itself is gone). */
function unstale() {
  const err = $('#ai-err');
  if (err?.textContent.endsWith(STILL)) err.textContent = err.textContent.slice(0, -STILL.length).trimEnd();
}

/** The box's markup: a text area, its button, and where the key form opens. */
const BUTTON = 'Fill it in';
const box = (
  cls,
  label,
  placeholder,
  button = BUTTON,
  after = 'Check everything before you create the poll.',
  sent = 'Sent to Anthropic’s Claude.',
) => `<div class="ai-draft ${cls}" id="ai-draft">
    <label for="ai-prompt">${label}</label>
    <div class="ai-row">
      <textarea id="ai-prompt" rows="2" maxlength="600" placeholder="${placeholder}"></textarea>
      <button type="button" class="btn ai-use" id="ai-go">${button}</button>
    </div>
    <p class="ai-wait" id="ai-wait" role="status" hidden><img src="/img/dog.webp" alt="" width="40" height="40">Finn is on it. Thinking…</p>
    <p class="field-err" id="ai-err" role="alert"></p>
    <p class="hint"><span id="ai-sent">${sent}</span> ${after} <span id="ai-key-link"></span></p>
    <div id="ai-key-box" hidden></div>
  </div>`;

/** No key: close the box and go to the form AI would have filled, focused on its first control. */
function byHand() {
  closeBox();
  const field = $('#ask') ? $('#title') : null;
  const after = field
    ? []
    : [...$('.ai-head').parentElement.children].filter((el) => !el.matches('.ai-head, .ai-draft, .ai-done'));
  const first = field || after.map((el) => el.querySelector('input:not([type=hidden]), button, textarea, select')).find(Boolean);
  (first || $('#ai-open'))?.focus({ preventScroll: true });
  (first || $('#ai-open'))?.scrollIntoView({ block: 'center' });
}

/**
 * The hint's end: "Use your own key", only once it's needed (ai-key.js keyHint), after `say`'s line.
 * Asked for when the box first opens, so a page that never opens it never asks.
 */
function hintOnOpen(say) {
  const hint = () => keyHint($('#ai-draft'), $('#ai-key-link'), $('#ai-key-box'), say);
  if ($('#ai-open') && $('#ai-draft').hidden) $('#ai-open').addEventListener('click', hint, { once: true });
  else hint();
}

/** Wire the box: `fill(prompt)` asks and fills in, and says what it did. */
function wire(fill, button = BUTTON) {
  const go = async () => {
    const prompt = $('#ai-prompt').value.trim();
    if (!prompt) return $('#ai-prompt').focus();
    const btn = $('#ai-go');
    btn.disabled = true;
    btn.textContent = 'Thinking…';
    $('#ai-wait').hidden = false; // Finn, at once: the answer takes a few seconds
    $('#ai-err').textContent = '';
    try {
      await fill(prompt);
    } catch (ex) {
      // A key problem opens the key form; anything else is said in the box, with what to do.
      // "Fill it in yourself" only where Use AI opened the box and the form is right below it.
      if (keyProblem(ex)) aiFailed(ex, $('#ai-key-box'), go, $('#ai-open') ? byHand : undefined);
      else refused(ex.message || 'AI didn’t answer. Try again in a moment.');
    } finally {
      btn.disabled = false;
      btn.textContent = button;
      $('#ai-wait').hidden = true;
    }
  };
  $('#ai-go').onclick = go;
  // Ctrl or ⌘ + Enter in the box asks, as the button does; Enter alone is a new line.
  $('#ai-prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !$('#ai-go').disabled) {
      e.preventDefault();
      go();
    }
  });
}

// ---------- the one box above Date · Vote (/new and /new/topic) ----------

const ASK_KEY = 'venn:ask'; // what the box filled, carried to the other form when it picked that kind
const ASK_TTL = 60_000;
const PATHS = { free: '/new', topic: '/new/topic' };
const PLACEHOLDERS = ['Book club, any weeknight in the next two weeks', 'Dinner Friday: Rosa’s, Luigi’s or Thai'];

/** Choices to name in a line: "Italian, Thai or Mexican". */
const either = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`);

/** The open box: what to describe, Fill it in, the hint and Close. `ai` false: Venn reads days itself. */
const askBox = (ai) => `<div class="ai-draft" id="ai-draft" hidden>
    <label for="ai-prompt">${ai ? 'Describe what you’re planning' : 'Say when, and Venn picks the days'}</label>
    <div class="ai-row">
      <textarea id="ai-prompt" rows="3" maxlength="600" placeholder="${
        ai ? PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)] : 'Fridays next month, or evenings this week'
      }"></textarea>
      <button type="button" class="btn ai-use" id="ai-go">${BUTTON}</button>
    </div>
    <p class="ai-wait" id="ai-wait" role="status" hidden><img src="/img/dog.webp" alt="" width="40" height="40">Finn is on it. Thinking…</p>
    <p class="field-err" id="ai-err" role="alert"></p>
    <div class="ai-go-row">
      <p class="hint"><span id="ai-sent">${
        ai ? 'Venn picks a date poll or a vote. Sent to Anthropic’s Claude.' : 'Venn reads this itself.'
      }</span> ${ai ? 'Check everything before you create the poll.' : 'Check the days before you create the poll.'} <span id="ai-key-link"></span></p>
      <button type="button" class="link-btn" id="ai-close">Close</button>
    </div>
    <div id="ai-key-box" hidden></div>
  </div>`;

/** The box's closed bar: with AI it reads what to make; without, only the days (and only on /new). */
const askBar = (ai) =>
  `<button type="button" class="ask-bar" id="ai-open" aria-expanded="false" aria-controls="ai-draft"><span class="ask-spark" aria-hidden="true">✨</span><span>${
    ai ? 'Describe it, and Venn sets it up' : 'Say when, and Venn picks the days'
  }</span></button>`;

/**
 * Put the box above the Date · Vote switch: a quiet bar that opens into the box, in place. With no
 * box to offer (`box` false), only the place where a result shows. Returns false where there's no
 * switch (editing or copying a poll) or the page is a white-label template's.
 */
async function mountAsk(box, ai) {
  const sw = $('.kind-switch');
  const early = $('#ask[data-early]'); // the bar the switch drew from last time (create.js kindSwitch)
  const { whiteLabel, rememberAsk } = await import('./create.js');
  if (!sw || (!early && $('#ask')) || whiteLabel()) {
    if (sw && early) {
      early.remove();
      rememberAsk({ date: '', topic: '' });
    }
    return false;
  }
  const bar = askBar(ai);
  const html = box ? bar + askBox(ai) : '';
  if (early) {
    early.removeAttribute('data-early');
    early.innerHTML = html; // the same bar, now working
  } else sw.insertAdjacentHTML('beforebegin', `<div class="ask" id="ask">${html}</div>`);
  rememberAsk(ai ? { date: bar, topic: bar } : { date: askBar(false), topic: '' });
  if (!box) return true;
  const open = (yes) => {
    $('#ai-draft').hidden = !yes;
    $('#ai-open').hidden = yes;
    $('#ai-open').setAttribute('aria-expanded', yes);
    (yes ? $('#ai-prompt') : $('#ai-open')).focus();
  };
  $('#ai-open').onclick = () => open(true);
  $('#ai-close').onclick = () => open(false);
  $('#ai-prompt').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    open(false);
  });
  return true;
}

/** What the box filled on the other form, for this one (`here`: 'free' or 'topic'), once; or null. */
function takeAsk(here) {
  const d = readStored(sessionStorage, ASK_KEY);
  if (!d) return null;
  try {
    sessionStorage.removeItem(ASK_KEY); // never kept: no days come back later, no draft goes stale
  } catch {}
  return d.to === here && Date.now() - d.at >= 0 && Date.now() - d.at < ASK_TTL && d.draft ? d : null;
}

/** Go to the other form (`to`) with the box's draft, as the Date · Vote switch goes (a brand stays). */
function handOff(to, draft, prompt, back = location.pathname) {
  const prev = readStored(sessionStorage, formDraftKey(to));
  try {
    sessionStorage.setItem(ASK_KEY, JSON.stringify({ to, draft, prompt, back, had: hasWork(prev), at: Date.now() }));
  } catch {}
  switchTo(to);
}
const hasWork = (d) => formDraftHasWork(cleanFormDraft(d, new Date().toLocaleDateString('en-CA')));
const switchTo = (to) => $(`.kind-switch a[href^="${PATHS[to]}"]:not([aria-current])`)?.click();

/** The first line of the result: the kind Venn picked, and why, in words. */
function kindLine(d) {
  if (d.kind === 'date') return 'Venn made this a date poll, because you asked when.';
  if (d.why === 'both' && d.note) return `Venn made this a vote, because ${d.note.split(',')[0]} is already set.`;
  if (d.why === 'both')
    return `Venn made this a vote${d.options.length > 1 ? ` on ${either(d.options)}` : ' first'}. Once it’s picked, Find a date for it gives you the days.`;
  if (d.yesNo) return 'Venn made this a vote, because you asked yes or no.';
  if (d.why === 'words') return 'Venn made this a vote, because you asked for one.';
  if (d.why === 'open' && d.options.length > 1) return 'Venn made this a vote, because you named choices to pick from.';
  return d.options.length > 1
    ? 'Venn made this a vote, because there’s no date to find. Check the options it suggested.'
    : 'Venn made this a vote, because there’s no date to find. Add the options below.';
}

/**
 * The box on a create form. `here` is 'free' (/new) or 'topic' (/new/topic); `apply(draft)` fills
 * this form from the box's answer and returns { said, undo, changed }: what it read, how to put the
 * form back, and what to light up. A draft of the other kind goes to the other form, which shows it.
 */
async function askHere(here, apply, { ai, box = true, ready }) {
  const carried = takeAsk(here);
  if (!(await mountAsk(box, ai)) && !carried) return;
  if (!$('#ask') && !(await mountAsk(false, ai))) return;
  const show = async (draft, prompt, { moved = false, had = false, back = '' } = {}) => {
    const { said, undo, changed } = await apply(draft);
    light(changed);
    $('#create')?.dispatchEvent(new Event('change')); // the form's draft (form-draft.js) follows
    const replaced = had && `It replaced the ${here === 'topic' ? 'vote' : 'date poll'} you’d started. Undo brings it back.`;
    if (moved || draft.why === 'both') said.note = [said.note, replaced].filter(Boolean).join(' ') || '';
    said.kind = kindLine(draft); // always: the kind Venn made, and why
    done(said, async () => {
      await undo();
      $('#create')?.dispatchEvent(new Event('change'));
      if (!moved || back === location.pathname) return;
      track('ai.ask', { undone: 'yes' });
      await new Promise((r) => setTimeout(r)); // the form's draft is kept first
      switchTo(here === 'topic' ? 'free' : 'topic');
    });
    // Choices with a time: the days AI read are one tap away, with no second request.
    const days = here === 'topic' && draft.date;
    const vote = here === 'free' && draft.vote?.both ? draft.vote : null;
    if (days || vote) {
      $('#ai-undo').insertAdjacentHTML(
        'beforebegin',
        `<button type="button" class="link-btn" id="ai-other">${days ? 'Make it a date poll instead' : 'Vote on it first'}</button>`,
      );
      $('#ai-other').onclick = async () => {
        await undo(); // this form as it was, then the other one, filled
        $('#create')?.dispatchEvent(new Event('change'));
        if (days) track('ai.ask', { switched: 'yes' });
        await new Promise((r) => setTimeout(r));
        const next = days
          ? { kind: 'date', why: draft.why, ...draft.date, title: draft.question }
          : { kind: 'vote', why: 'both', question: vote.question, yesNo: false, options: vote.options, note: '', date: null };
        handOff(here === 'topic' ? 'free' : 'topic', next, prompt, moved ? back : location.pathname);
      };
    }
    if (moved) {
      // Moved here from the other form: the result is what's read first, where the bar is.
      const line = $('#ai-done > p');
      line.tabIndex = -1;
      line.focus({ preventScroll: true });
      line.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  };
  if (box && $('#ai-go'))
    wire(async (prompt) => {
      const draft = await api('ai/draft', {
        method: 'POST',
        body: { prompt, timezone: $('#tz').value },
        headers: aiHeaders(),
      });
      const to = draft.kind === 'vote' ? 'topic' : 'free';
      if (to !== here) return handOff(to, draft, prompt);
      closeBox();
      await show(draft, prompt);
    });
  if (carried) {
    await ready;
    if (!$('#create')) return;
    $('#draft-note')?.remove(); // "Picked up where you left off": what follows replaces it
    if ($('#ai-prompt')) $('#ai-prompt').value = String(carried.prompt || '').slice(0, 600);
    await show(carried.draft, carried.prompt, { moved: true, had: !!carried.had, back: carried.back });
  }
}

/**
 * On /new: one sentence fills the whole poll for review: its name, an emoji, the place, how people
 * answer, days in a row and the days with their times (into `st`, as create-free.js keeps them).
 * Asking again replaces what's picked, and Undo puts back exactly what was there before. Hooks from
 * the page: `empty()`, `setRow(n)`, `show(level)`, the current `level()` and `row()`, and `ready`,
 * which settles once any draft of the form is back.
 */
export function aiDays(st, { empty, setRow, show, level, row, ready }, { ai } = { ai: true }) {
  if (!$('#when-h')) return;
  // What AI itself filled in last time: asking again may replace those, never what was typed.
  let filled = {};
  let drafted = ''; // the picks AI made last time, to tell its own draft from days picked by hand
  const sets = () => [st.days, st.parts, st.hours, st.maybe.days, st.maybe.parts, st.maybe.hours];
  const key = (list) => JSON.stringify(list.map((set) => [...set].sort()));
  const asked = askHere(
    'free',
    async (draft) => {
      const { iconEmoji, setIconEmoji, iconBg, setIconBg } = await import('./create.js'); // the page's own, already loaded
      const [t, where] = [$('#title'), $('#location')];
      const before = {
        title: t.value,
        seed: t.dataset.seed,
        where: where.value,
        emoji: iconEmoji(),
        bg: iconBg(),
        level: level(),
        row: row(),
        picks: sets().map((set) => new Set(set)),
        filled,
        drafted,
      };
      const had = !empty();
      const ours = (now, was) => !now.trim() || now === was;
      const changed = [];
      const next = {};
      if (draft.title && (ours(t.value, filled.title) || t.value === t.dataset.seed)) {
        t.value = next.title = draft.title;
        t.dispatchEvent(new Event('input'));
        changed.push(t);
      }
      const tile = $('#emoji-tile');
      if (draft.emoji && ours(before.emoji, filled.emoji) && (await setIconEmoji(draft.emoji))) {
        next.emoji = draft.emoji;
        changed.push(tile);
      }
      // Its background, from Venn's own set (tile-styles.js), unless they picked one or it's a brand's poll.
      if (draft.tile && ours(before.bg, filled.bg) && (await setIconBg(draft.tile))) {
        next.bg = draft.tile;
        if (!changed.includes(tile)) changed.push(tile);
      }
      if (draft.location && ours(where.value, filled.where)) {
        where.value = next.where = draft.location;
        $('#more-box').open = true;
        changed.push(where);
      }
      filled = next;
      // The days replace whatever was picked. Each pick goes in its level's set, and in its
      // "if needed" set too when the person called it optional.
      for (const set of sets()) set.clear();
      setRow(draft.level === 'days' ? draft.row || 1 : 1);
      const pick = (key, ifNeeded) => {
        st[draft.level].add(key);
        if (ifNeeded) st.maybe[draft.level].add(key);
      };
      for (const d of draft.days.slice(0, LIMITS.dates))
        if (draft.level === 'hours') for (let m = d.start; m < d.end; m += 30) pick(`${d.date}|${m}`, d.ifNeeded);
        else if (draft.level === 'parts') pick(`${d.date}|${DAY_PARTS.find((p) => p.key === d.part).start}`, d.ifNeeded);
        else pick(d.date, d.ifNeeded);
      await show(draft.level);
      const said = describeDraft(draft, changed.includes(t) ? t.value : '');
      const replaced = !had
        ? ''
        : before.drafted === key(before.picks)
          ? 'It replaced the last draft. Undo brings it back.'
          : 'It replaced the days you had picked. Undo brings them back.';
      drafted = key(sets());
      if (replaced) said.note = [said.note, replaced].filter(Boolean).join(' ');
      const undo = async () => {
        sets().forEach((set, i) => {
          set.clear();
          for (const k of before.picks[i]) set.add(k);
        });
        filled = before.filled;
        drafted = before.drafted;
        t.value = before.title;
        t.dataset.seed = before.seed ?? '';
        t.dispatchEvent(new Event('input')); // whatever follows the name (the link preview) follows it back
        where.value = before.where;
        if (iconEmoji() !== before.emoji) await setIconEmoji(before.emoji);
        if (iconBg() !== before.bg) await setIconBg(before.bg);
        setRow(before.row);
        await show(before.level);
      };
      return { said, undo, changed: [...changed, ...$$('#free-list .chip')] };
    },
    { ai, ready },
  );
  // With no AI here, there's no key to add.
  if (ai)
    asked.then(
      () =>
        $('#ai-go') &&
        hintOnOpen(
          usedLine('This week’s free AI requests are used up, so Venn reads this itself.', 'Say when, and Venn picks the days'),
        ),
    );
}

/**
 * Past this week's free AI requests, the hint says so first, in place of "Sent to Anthropic’s
 * Claude" (nothing is, without a key); it comes back once a key is saved. `used` is the line.
 */
const usedLine =
  (used = 'This week’s free AI requests are used up.', heading = '') =>
  (state) => {
    const swap = (el, to) => {
      el.dataset.was ??= el.textContent;
      el.textContent = state === 'used' ? to : el.dataset.was;
    };
    swap($('#ai-sent'), used);
    if (heading) swap($('label[for="ai-prompt"]'), heading); // the heading follows: no AI fills it in now
    return '';
  };

/**
 * On a vote (/new/topic): the same box. `fill({ question, yesNo, options, note })` puts a vote in
 * the form; `snapshot()` returns a function that puts the form back as it was, for Undo. Without AI
 * there's no box here (Venn can't read choices well by itself), but a vote the box on /new made
 * still lands.
 */
export function aiTopic(fill, snapshot, { ai, ready } = { ai: true }) {
  if (!$('#plan-h')) return;
  const asked = askHere(
    'topic',
    async (draft) => {
      const undo = snapshot();
      fill(draft);
      const n = draft.yesNo ? 'Yes or no' : plural(draft.options.length, 'option');
      return {
        said: { head: `${draft.question} · ${n}`, note: draft.note ? `Note for everyone: ${draft.note}.` : '' },
        undo,
        changed: [$('#title'), ...(draft.yesNo ? [] : $$('#opts input')), ...(draft.note ? [$('#desc')] : [])],
      };
    },
    { ai, box: ai, ready },
  );
  if (ai)
    asked.then(() => $('#ai-go') && hintOnOpen(usedLine('This week’s free AI requests are used up, so Venn reads this itself.')));
}

/** On "vote on a few dates": "Use AI" beside "When could it be?"; `load(options, tz)` fills in the options. */
export function aiDraft(form, load) {
  if (!$('#when-h', form)) return;
  useAiButton(
    $('#when-h', form),
    box('ai-inline', 'Describe it, and AI fills in the form', 'Dinner for 6, any evening next week except Monday'),
  );
  wire(async (prompt) => {
    const tz = $('#tz').value;
    const draft = await api('ai/draft-poll', { method: 'POST', body: { prompt, timezone: tz }, headers: aiHeaders() });
    const t = $('#title');
    if (!t.value.trim() || t.value === t.dataset.seed) t.value = draft.title;
    if (!$('#desc').value.trim() && draft.description) {
      $('#desc').value = draft.description;
      $('#more-box').open = true;
    }
    // Options that are each a morning, afternoon or evening become half days; others keep their minutes.
    await load(
      draft.options.map((o) => ({ start: o.start, end: o.start + draft.durationMinutes * MINUTE })),
      tz,
    );
    closeBox();
    $('#preview-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`Filled in ${plural(draft.options.length, 'option')}. Check them, then create the poll.`);
  });
  hintOnOpen(usedLine());
}

/**
 * On a brand template's "Starting look": a few words about the organization fill in the template
 * for review: its look, and its name, emoji and usual poll name where those are still empty.
 * `name()` is the organization's name so far; `apply(draft)` fills it in and returns
 * { changed, text, undo }: the elements it changed, a line saying what it did, and how to put it back.
 */
export function aiLook(host, { name, apply }) {
  host.innerHTML = box(
    'ai-inline',
    'Or describe your organization',
    'Riverside Runners, a running club, bright orange, friendly and bold',
    'Suggest a look',
    'You can change everything after.',
  );
  wire(async (prompt) => {
    const draft = await api('ai/draft-template', {
      method: 'POST',
      body: { prompt, name: name() },
      headers: aiHeaders(),
    });
    const { changed, text, undo } = apply(draft);
    light(changed);
    done(text, undo);
  }, 'Suggest a look');
  hintOnOpen(usedLine());
}
