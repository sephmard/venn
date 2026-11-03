// A one-line note on an answer ("Can only stay till 9"), on date and vote polls alike: the field
// under Your name (#note-slot) and the group's Notes (#notes-slot) at the end of The group. The
// pages only carry those two empty hooks and send `#note`'s value with the answer; everything
// else is here, loaded after the page. Without this module the answer still saves, and the server
// keeps the note it had. Notes are plain text: esc() always, never linked.

import { LIMITS } from './core.js';
import { readStored, writeStored } from './drafts.js';
import { $, esc } from './ui.js';

/**
 * Fill both hooks for poll `id`. `ev` is the poll as this visitor sees it (the server leaves out
 * other guests' notes when names or answers are hidden), `mine` this visitor's answer, if any.
 */
export function mountNotes(id, ev, mine) {
  const list = $('#notes-slot');
  if (list) {
    const withNote = ev.participants.filter((p) => p.note);
    list.innerHTML = withNote.length
      ? `<h3 class="kicker">Notes</h3><ul class="answer-notes">${withNote.map((p) => `<li><b>${esc(p.name)}</b> ${esc(p.note)}</li>`).join('')}</ul>`
      : '';
  }
  const slot = $('#note-slot');
  // Drawn once per page draw, so what someone is typing stays put when the rest refreshes.
  if (!slot || slot.dataset.on) return;
  slot.dataset.on = 1;
  const key = `venn:answer-draft:${id}`;
  const sent = mine?.note || '';
  const typed = readStored(localStorage, key)?.note;
  const value = typeof typed === 'string' ? typed.slice(0, LIMITS.note) : sent;
  // Answers closed, or decided: the note shows, but isn't changed here (nor is the answer).
  const closed = !ev.isAdmin && ev.deadline != null && Date.now() >= ev.deadline;
  if (closed || ev.finalStart != null || ev.picked != null) {
    slot.innerHTML = sent ? `<p class="hint">Your note: ${esc(sent)}</p>` : '';
    return;
  }
  const open = (focus) => {
    slot.innerHTML = `<label for="note">Note for the group <span class="muted">(optional)</span></label>
      <input id="note" type="text" maxlength="${LIMITS.note}" autocomplete="off" enterkeyhint="done" placeholder="Can only stay till 9">`;
    const input = $('#note');
    input.value = value;
    input.oninput = () => {
      // Not sent yet, as when the name changes: the page keeps its unsent answer, then the note joins it.
      $('#name')?.dispatchEvent(new Event('input'));
      writeStored(localStorage, key, { at: Date.now(), ...readStored(localStorage, key), note: input.value });
    };
    if (focus) input.focus();
  };
  // A note already, or one changed and not sent yet (even emptied): the field. Otherwise one link.
  if (value || value !== sent) return open(false);
  slot.innerHTML =
    '<button type="button" class="link-btn note-add" aria-expanded="false" aria-controls="note">+ Add a note</button>';
  $('.note-add', slot).onclick = () => open(true);
}
