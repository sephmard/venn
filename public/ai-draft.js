// "Use AI": describe it, and AI fills it in. On "Create a Venn" (/new) it picks the days on the
// calendar, on "vote on a few dates" it fills in the form, on a vote (/new/topic) it writes the
// question and options, and on a brand template's "Starting look" it suggests the colours, fonts
// and shape. AI is optional, so this loads only when the server has it switched on.

import { DAY_PARTS, LIMITS, MINUTE } from './core.js';
import { $, $$, api, esc, plural, reducedMotion, toast } from './ui.js';

import { aiFailed, aiHeaders, keyLink, wireKeyLink } from './ai-key.js';
import { describeDraft } from './draft-summary.js';

const keyProblem = (ex) => ex.status === 402 || (ex.status === 400 && /key/i.test(ex.message));

// The "Use AI" button: a pill with a gradient edge and a sparkle, beside a section's heading. Its
// look lives here, since only pages with AI on ever load it.
document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
  .ai-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .ai-head > h2 { margin-bottom: 0; min-width: 0; }
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
function useAiButton(h2, boxHtml) {
  const head = document.createElement('div');
  head.className = 'ai-head';
  h2.before(head);
  head.append(h2);
  head.insertAdjacentHTML(
    'beforeend',
    `<button type="button" class="ai-use" id="ai-open" aria-expanded="false" aria-controls="ai-draft">${SPARKLE}Use AI</button>`,
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
  const { head, when, note } = typeof said === 'string' ? { head: said } : said;
  const lines = [
    head && `<b class="ai-done-head">${esc(head)}</b>`,
    when && `<span class="ai-done-when">${esc(when)}</span>`,
    note && `<small class="ai-done-note">${esc(note)}</small>`,
  ].filter(Boolean);
  $('#ai-draft').insertAdjacentHTML(
    'afterend',
    `<div class="ai-done" id="ai-done" role="status"><p>${lines.join(' ')}</p><button type="button" class="link-btn" id="ai-undo">Undo</button></div>`,
  );
  $('#ai-undo').onclick = async () => {
    await undo();
    $('#ai-done')?.remove();
    ($('#ai-open') || $('#ai-prompt'))?.focus();
    toast('Put back as it was.');
  };
  $('#ai-done').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
}

/** The box's markup: a text area, its button, and where the key form opens. */
const BUTTON = 'Fill it in';
const box = (
  cls,
  label,
  placeholder,
  button = BUTTON,
  after = 'Check everything before you create the poll.',
) => `<div class="ai-draft ${cls}" id="ai-draft">
    <label for="ai-prompt">${label}</label>
    <div class="ai-row">
      <textarea id="ai-prompt" rows="2" maxlength="600" placeholder="${placeholder}"></textarea>
      <button type="button" class="btn ai-use" id="ai-go">${button}</button>
    </div>
    <p class="ai-wait" id="ai-wait" role="status" hidden><img src="/img/dog.webp" alt="" width="40" height="40">Finn is on it. Thinking…</p>
    <p class="field-err" id="ai-err" role="alert"></p>
    <p class="hint">Sent to Anthropic’s Claude. ${after} <span id="ai-key-link"></span></p>
    <div id="ai-key-box" hidden></div>
  </div>`;

/** No key: close the box and go to the form AI would have filled, focused on its first control. */
function byHand() {
  closeBox();
  const after = [...$('.ai-head').parentElement.children].filter((el) => !el.matches('.ai-head, .ai-draft, .ai-done'));
  const field = after.map((el) => el.querySelector('input:not([type=hidden]), button, textarea, select')).find(Boolean);
  (field || $('#ai-open'))?.focus({ preventScroll: true });
  (field || $('#ai-open'))?.scrollIntoView({ block: 'center' });
}

/** Wire the box: `fill(prompt)` asks and fills in, and says what it did. */
function wire(fill, button = BUTTON) {
  $('#ai-key-link').innerHTML = keyLink();
  wireKeyLink($('#ai-draft'), $('#ai-key-box'));
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
      else $('#ai-err').textContent = ex.message || 'AI didn’t answer. Try again in a moment.';
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

/**
 * On /new: "Use AI" beside "When could it be?" opens the box. One sentence fills the whole poll for
 * review: its name, an emoji, the place, how people answer, days in a row and the days with their
 * times (into `st`, as create-free.js keeps them). Asking again replaces what's picked, and Undo puts
 * back exactly what was there before. Hooks from the page: `empty()`, `setRow(n)`, `show(level)`,
 * and the current `level()` and `row()`.
 */
export function aiDays(st, { empty, setRow, show, level, row }) {
  if (!$('#when-h')) return;
  useAiButton(
    $('#when-h'),
    box('ai-inline', 'Describe it, and AI fills in the poll', 'Friendsgiving at mine, a Saturday evening in late November'),
  );
  // What AI itself filled in last time: asking again may replace those, never what was typed.
  let filled = {};
  let drafted = ''; // the picks AI made last time, to tell its own draft from days picked by hand
  const sets = () => [st.days, st.parts, st.hours, st.maybe.days, st.maybe.parts, st.maybe.hours];
  const key = (list) => JSON.stringify(list.map((set) => [...set].sort()));
  wire(async (prompt) => {
    const draft = await api('ai/draft-days', {
      method: 'POST',
      body: { prompt, timezone: $('#tz').value },
      headers: aiHeaders(),
    });
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
    closeBox();
    light([...changed, ...$$('#free-list .chip')]);
    const said = describeDraft(draft, changed.includes(t) ? t.value : '');
    const replaced = !had
      ? ''
      : before.drafted === key(before.picks)
        ? 'It replaced the last draft. Undo brings it back.'
        : 'It replaced the days you had picked. Undo brings them back.';
    drafted = key(sets());
    if (replaced) said.note = [said.note, replaced].filter(Boolean).join(' ');
    done(said, async () => {
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
    });
  });
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
}

/**
 * On a vote (/new/topic): "Use AI" beside "What are you deciding?" writes the question and the
 * options. `fill({ question, yesNo, options })` puts them in the form; `snapshot()` returns a
 * function that puts the form back as it was, for Undo.
 */
export function aiTopic(fill, snapshot) {
  if (!$('#plan-h')) return;
  useAiButton(
    $('#plan-h'),
    box('ai-inline', 'Describe what you’re deciding', 'Dinner Friday: Rosa’s, Luigi’s or the new Thai place'),
  );
  wire(async (prompt) => {
    const draft = await api('ai/draft-topic', { method: 'POST', body: { prompt }, headers: aiHeaders() });
    const undo = snapshot();
    fill(draft);
    closeBox();
    light([$('#title'), ...(draft.yesNo ? [] : $$('#opts input'))]);
    done(draft.yesNo ? `${draft.question} · Yes or no` : `${draft.question} · ${plural(draft.options.length, 'option')}`, undo);
  });
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
}
