// The emails to send a poll to (src/invites.js), on the create page and in the organizer's Invite
// by email panel. Paste a whole list (from a spreadsheet, a mail app, a chat): commas, semicolons,
// spaces and new lines all work, names and repeats are dropped, and each address becomes a chip
// that can be taken off. Anything that isn't an email stays in the box, flagged, to fix.

import { parseEmails } from './parse-emails.js';
import { $, esc, toast } from './ui.js';

export const MAX_INVITEES = 50; // src/invites.js

// Its look, here rather than in styles.css: only signed-in organizers ever load this.
const CSS = `.inv-chips{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:6px 0 8px;max-height:40vh;overflow-y:auto;}.inv-chip{display:inline-flex;align-items:center;max-width:100%;min-height:44px;padding-left:14px;border-radius:999px;background:var(--accent-soft);color:var(--text);font-size:0.9375rem;}.inv-chip span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.inv-chip button{min-width:44px;min-height:44px;border:0;border-radius:999px;background:none;color:inherit;font-size:1.25rem;line-height:1;cursor:pointer;}.inv-chip button:hover{color:var(--danger);}.invite-field .hint.field-err{color:var(--danger);font-weight:600;}#invite-box h3{margin:20px 0 4px;font-size:1rem;}#invitee-list li{align-items:baseline;}#invitee-list .link-btn{margin-left:auto;}`;

/** The field. `label` names it; `taken` is how many are already on the list (the panel). */
export function field({ label = 'Their emails', placeholder = 'Paste or type emails' } = {}) {
  return `<div class="invite-field">
    <label for="inv-input">${esc(label)}</label>
    <ul class="inv-chips" id="inv-chips" aria-label="People to email" hidden></ul>
    <textarea id="inv-input" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="email" placeholder="${esc(placeholder)}" aria-describedby="inv-note"></textarea>
    <p class="hint" id="inv-note" aria-live="polite">Paste a whole list: commas, spaces or new lines all work.</p>
  </div>`;
}

/**
 * Make the field work. `taken`: emails already on the list (left out, and counted toward the limit).
 * `onChange(count)` hears the list change. Returns { emails(), commit() → whether everything typed is
 * an email, clear() }.
 */
export function wire({ taken = [], onChange = () => {} } = {}) {
  if (!document.getElementById('inv-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'inv-css', textContent: CSS }));
  const input = $('#inv-input');
  const chips = $('#inv-chips');
  const note = $('#inv-note');
  const known = new Set(taken);
  let list = [];
  const draw = (msg = '', bad = false) => {
    chips.hidden = !list.length;
    chips.innerHTML = list
      .map(
        (e, i) =>
          `<li class="inv-chip"><span>${esc(e)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(e)}">×</button></li>`,
      )
      .join('');
    const count = list.length ? `${list.length} ${list.length === 1 ? 'person' : 'people'}` : '';
    note.textContent = [count, msg].filter(Boolean).join(' · ') || 'Paste a whole list: commas, spaces or new lines all work.';
    note.classList.toggle('field-err', bad);
    input.setAttribute('aria-invalid', String(bad));
    onChange(list.length);
  };
  /** Move what's typed into the list; returns false when something in it isn't an email. */
  const commit = () => {
    const { emails, invalid, repeats } = parseEmails(input.value);
    let again = repeats;
    let over = 0;
    for (const e of emails) {
      if (known.has(e) || list.includes(e)) again++;
      else if (known.size + list.length >= MAX_INVITEES) over++;
      else list.push(e);
    }
    input.value = invalid.join(', ');
    const msg = [
      again && `${again} already on the list`,
      over && `${over} left out: ${MAX_INVITEES} at most`,
      invalid.length && `Check ${invalid.length === 1 ? 'this' : 'these'}: ${invalid.join(', ')}`,
    ].filter(Boolean);
    draw(msg.join(' · '), invalid.length > 0 || over > 0);
    return !invalid.length;
  };
  input.addEventListener('paste', () => setTimeout(commit));
  input.addEventListener('blur', () => input.value.trim() && commit());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
    }
  });
  // A comma or space after an address takes it, as in a mail app's To line.
  input.addEventListener('input', () => /@[^\s,;]+[\s,;]$/.test(input.value) && commit());
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    list.splice(+b.dataset.rm, 1);
    draw();
    input.focus();
  });
  return {
    emails: () => [...list],
    commit: () => (input.value.trim() ? commit() : true),
    clear: () => {
      list = [];
      input.value = '';
      draw();
    },
  };
}

/**
 * On the create page: the "Email it to people" row, whose count shows the Deadline's reminders
 * (`deadline`: deadline-fields.js). Returns { into(body) }: puts the list on the new poll, or says
 * what to fix and returns false; and { done(body) }, once it's made.
 */
export function onCreate(deadline) {
  const opts = $('#invite-opts');
  if (!opts) return null;
  $('#invite-box').innerHTML =
    `${field()}<p class="hint">Venn emails each of them the link as soon as your poll is made. Only you see the list.</p>`;
  const list = wire({
    onChange: (n) => {
      deadline.setInvitees(n);
      // Venn knows who answered by the email they answer with, so the poll asks for it.
      if (n) $('#p-email').checked = true;
    },
  });
  opts.hidden = false;
  return {
    into(body) {
      if (opts.hidden) return true;
      if (!list.commit()) {
        opts.open = true;
        $('#err').textContent = 'Check the emails under “Email it to people”.';
        $('#inv-input').focus();
        return false;
      }
      if (list.emails().length) body.invitees = list.emails();
      return true;
    },
    /** Once the poll is made. */
    done({ invitees }) {
      if (invitees) toast(`Venn is emailing it to ${invitees.length} ${invitees.length > 1 ? 'people' : 'person'}.`);
    },
  };
}
