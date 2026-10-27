// "Describe it, and AI fills in the form" on "vote on a few dates". AI is optional, so this loads
// only when the server has it switched on.

import { MINUTE } from './core.js';
import { $, api, plural, toast } from './ui.js';

/** Add the box above the form's first section; `load(options, tz)` fills in the draft's options. */
export function aiDraft(form, load) {
  form.querySelector('.sheet').insertAdjacentHTML(
    'beforebegin',
    `<div class="ai-draft sheet" id="ai-draft">
      <label for="ai-prompt">Describe it, and AI fills in the form</label>
      <div class="ai-row">
        <textarea id="ai-prompt" rows="2" maxlength="600" placeholder="Dinner for 6, any evening next week except Monday"></textarea>
        <button type="button" class="btn" id="ai-go">Fill it in</button>
      </div>
      <p class="hint">Your description is sent to Anthropic's Claude. Check everything before you create the poll.</p>
    </div>`,
  );
  $('#ai-go').onclick = async () => {
    const prompt = $('#ai-prompt').value.trim();
    if (!prompt) return $('#ai-prompt').focus();
    const btn = $('#ai-go');
    btn.disabled = true;
    btn.textContent = 'Filling in…';
    try {
      const tz = $('#tz').value;
      const draft = await api('ai/draft-poll', { method: 'POST', body: { prompt, timezone: tz } });
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
    } catch (ex) {
      toast(ex.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Fill it in';
    }
  };
}
