// "Answer for me" on the poll page: a guest says what works for them in words, and Claude fills in
// their answers to review. Only servers with AI switched on offer it, so it loads when it's opened.

import { $, api, toast } from './ui.js';

/**
 * Open or close the panel. ctx: { id, st (the poll page's state: mine, touched, aiNotes, lastBusy, tz),
 * done() to show the new answers }.
 */
export function answerForMe({ id, st, done }) {
  const panel = $('#ai-answer');
  if (!panel.firstElementChild) {
    panel.innerHTML = `<label for="ai-prefs">What works for you?</label>
      <textarea id="ai-prefs" rows="2" maxlength="600" placeholder="No Mondays. Weekends are best. I'm away on the 12th."></textarea>
      <label class="check" id="ai-use-cal-row" hidden><input type="checkbox" id="ai-use-cal" checked> Also use the busy times from my calendar</label>
      <div class="btn-row">
        <button type="button" class="btn btn-primary btn-sm" id="ai-answer-go">Fill in my answers</button>
        <span class="hint">Sent to Anthropic's Claude to fill in. You can change anything before saving.</span>
      </div>`;
    $('#ai-answer-go').onclick = async (e) => {
      const preferences = $('#ai-prefs').value.trim();
      if (!preferences) return $('#ai-prefs').focus();
      const busy = st.lastBusy && $('#ai-use-cal').checked ? st.lastBusy : [];
      if (Object.keys(st.mine).length && !confirm('Replace your current answers with AI suggestions?')) return;
      e.target.disabled = true;
      e.target.textContent = 'Thinking…';
      try {
        const { answers } = await api(`events/${id}/ai/answer`, { method: 'POST', body: { preferences, busy, timezone: st.tz } });
        st.mine = {};
        st.aiNotes = {};
        for (const [s, a] of Object.entries(answers)) {
          if (a.answer) st.mine[s] = a.answer;
          if (a.note) st.aiNotes[s] = a.note;
          st.touched.add(s);
        }
        panel.hidden = true;
        $('#ai-answer-btn').setAttribute('aria-expanded', false);
        done();
        toast('Filled in your answers. Check them, then save.');
      } catch (ex) {
        toast(ex.message);
      } finally {
        e.target.disabled = false;
        e.target.textContent = 'Fill in my answers';
      }
    };
  }
  panel.hidden = !panel.hidden;
  $('#ai-answer-btn').setAttribute('aria-expanded', !panel.hidden);
  $('#ai-use-cal-row').hidden = !st.lastBusy;
  if (!panel.hidden) $('#ai-prefs').focus();
}
