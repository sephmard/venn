// "Describe it, and AI fills it in": on "Create a Venn" (/new) it picks the days on the calendar,
// on "vote on a few dates" it fills in the form, and on a brand template's "Starting look" it
// suggests the colours, fonts and shape. AI is optional, so this loads only when the server has it
// switched on.

import { DAY_PARTS, LIMITS, MINUTE } from './core.js';
import { $, api, plural, toast } from './ui.js';

import { aiFailed, aiHeaders, keyLink, wireKeyLink } from './ai-key.js';

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
      <button type="button" class="btn" id="ai-go">${button}</button>
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
 * On /new: a quiet "Describe it instead" above the calendar opens the box. It's only used while
 * nothing is picked (`empty()`): the days AI found go into the page's picked days, parts of the
 * day or hours (`st`, as create-free.js keeps them), and `show(level)` shows that level.
 */
export function aiDays(st, empty, setRow, show) {
  if (!$('#when-h')) return;
  $('#when-h').insertAdjacentHTML(
    'afterend',
    `<p class="ai-open"><button type="button" class="link-btn" id="ai-open" aria-expanded="false" aria-controls="ai-draft">Describe it instead</button></p>
    ${box('ai-inline', 'Describe when it could be', 'Dinner, any Friday or Saturday evening this month')}`,
  );
  const panel = $('#ai-draft');
  panel.hidden = true;
  $('#ai-open').onclick = () => {
    panel.hidden = !panel.hidden;
    $('#ai-open').setAttribute('aria-expanded', !panel.hidden);
    if (!panel.hidden) $('#ai-prompt').focus();
  };
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
    panel.hidden = true;
    $('#ai-open').setAttribute('aria-expanded', false);
    $('#preview-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`Picked ${plural(new Set(draft.days.map((d) => d.date)).size, 'day')}. Check them, then create the Venn.`);
  });
}

/** On "vote on a few dates": the box above the form's first section; `load(options, tz)` fills in the options. */
export function aiDraft(form, load) {
  form
    .querySelector('.sheet')
    .insertAdjacentHTML(
      'beforebegin',
      box('sheet', 'Describe it, and AI fills in the form', 'Dinner for 6, any evening next week except Monday'),
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
    $('#preview-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`Filled in ${plural(draft.options.length, 'option')}. Check them, then create the poll.`);
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
