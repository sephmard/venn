// "Use AI": describe it, and AI fills it in. On "Create a Venn" (/new) it picks the days on the
// calendar, on "vote on a few dates" it fills in the form, on a vote (/new/topic) it writes the
// question and options, and on a brand template's "Starting look" it suggests the colours, fonts
// and shape. AI is optional, so this loads only when the server has it switched on.

import { DAY_PARTS, LIMITS, MINUTE } from './core.js';
import { $, api, plural, toast } from './ui.js';

import { aiFailed, aiHeaders, keyLink, wireKeyLink } from './ai-key.js';

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
  @media (prefers-reduced-motion: reduce) { .ai-use, .ai-use .ai-star { transition: none; animation: none; } }
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
    <p class="hint">Sent to Anthropic’s Claude. ${after} <span id="ai-key-link"></span></p>
    <div id="ai-key-box" hidden></div>
  </div>`;

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
    try {
      await fill(prompt);
    } catch (ex) {
      aiFailed(ex, $('#ai-key-box'), go);
    } finally {
      btn.disabled = false;
      btn.textContent = button;
    }
  };
  $('#ai-go').onclick = go;
}

/**
 * On /new: "Use AI" beside "When could it be?" opens the box. It's only used while
 * nothing is picked (`empty()`): the days AI found go into the page's picked days, parts of the
 * day or hours (`st`, as create-free.js keeps them), and `show(level)` shows that level.
 */
export function aiDays(st, empty, setRow, show) {
  if (!$('#when-h')) return;
  useAiButton($('#when-h'), box('ai-inline', 'Describe when it could be', 'Dinner, any Friday or Saturday evening this month'));
  wire(async (prompt) => {
    if (!empty()) return toast('Clear the days you’ve picked first, then describe it.');
    const draft = await api('ai/draft-days', {
      method: 'POST',
      body: { prompt, timezone: $('#tz').value },
      headers: aiHeaders(),
    });
    const t = $('#title');
    if (draft.title && (!t.value.trim() || t.value === t.dataset.seed)) t.value = draft.title;
    setRow(1);
    for (const d of draft.days.slice(0, LIMITS.dates))
      if (draft.level === 'hours') for (let m = d.start; m < d.end; m += 30) st.hours.add(`${d.date}|${m}`);
      else if (draft.level === 'parts') st.parts.add(`${d.date}|${DAY_PARTS.find((p) => p.key === d.part).start}`);
      else st.days.add(d.date);
    await show(draft.level);
    closeBox();
    $('#preview-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`Picked ${plural(new Set(draft.days.map((d) => d.date)).size, 'day')}. Check them, then create the Venn.`);
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
 * options. `fill({ question, yesNo, options })` puts them in the form.
 */
export function aiTopic(fill) {
  if (!$('#plan-h')) return;
  useAiButton(
    $('#plan-h'),
    box('ai-inline', 'Describe what you’re deciding', 'Dinner Friday: Rosa’s, Luigi’s or the new Thai place'),
  );
  wire(async (prompt) => {
    const draft = await api('ai/draft-topic', { method: 'POST', body: { prompt }, headers: aiHeaders() });
    fill(draft);
    closeBox();
    toast(
      draft.yesNo
        ? 'Wrote your yes or no question. Check it, then create the Venn.'
        : `Filled in ${plural(draft.options.length, 'option')}. Check them, then create the Venn.`,
    );
  });
}

/**
 * On a brand template's "Starting look": a few words about the organization suggest a look.
 * `name()` is the organization's name so far; `apply(look, title)` sets it, like a look card.
 */
export function aiLook(host, { name, apply }) {
  host.innerHTML = box(
    'ai-inline',
    'Or describe your organization',
    'A climbing gym, friendly and bold, orange and charcoal',
    'Suggest a look',
    'You can change everything after.',
  );
  wire(async (prompt) => {
    const { look, title } = await api('ai/draft-template', {
      method: 'POST',
      body: { prompt, name: name() },
      headers: aiHeaders(),
    });
    apply(look, title);
    toast('Look suggested. Change anything in the next steps.');
  }, 'Suggest a look');
}
