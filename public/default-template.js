// A signed-in account's default templates: the brand template (/brand) its new date polls start
// in, and the one its new votes start in (sprint D, G1–G3). Kept on the server (GET and PUT
// /api/me/defaults), checked there on every read: a template the account can't use any more
// comes back as no default. Set in My polls › Templates (account.js) and on the template's own
// page (brand.js); used by the create forms (create.js), which load this only when signed in.
// Which template wins on a form: startingTemplate in drafts.js.

import { cleanFormDraft, defaultFor, formDraftHasWork, readStored, savedText, startingTemplate } from './drafts.js';
import { $, esc, toast } from './ui.js';

export { defaultPill } from './drafts.js';

/** The create form's kind (create.js keepDraft) → the format its default is kept under. */
export const FORMAT = { free: 'date', topic: 'vote' };

let asked = null;
/**
 * { date: { id, name } | null, vote: … }, or null when signed out or it can't be read. Asked once
 * until `fresh` (a new form) or a change.
 */
export function readDefaults(fresh = false) {
  if (fresh) asked = null;
  asked ??= fetch('/api/me/defaults', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d?.defaults ?? null)
    .catch(() => null);
  return asked;
}

/** Make `template` (an id, or null for none) the default for `format`. Resolves to the defaults now. */
export async function setDefault(format, template) {
  const r = await fetch('/api/me/defaults', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format, template }),
  }).catch(() => null);
  const d = await r?.json().catch(() => null);
  // Its own words when it says why (a template not in the account); otherwise, try again.
  if (!r?.ok || !d?.defaults) throw new Error((r?.status === 403 && d?.error) || "Couldn't save that. Try again.");
  asked = Promise.resolve(d.defaults);
  return d.defaults;
}

/**
 * The template a new form of `kind` starts in, when its link names none: the draft's (if one's
 * being picked up), else the default. Asks the server unless the draft is in Venn's look.
 * `stored`: the form's draft as the page found it (sessionStorage), before the form kept it again.
 */
export async function startFor(kind, stored) {
  const d = cleanFormDraft(readStored({ getItem: () => stored }, ''), new Date().toLocaleDateString('en-CA'));
  const draft = formDraftHasWork(d) ? d : null;
  const defaults = draft && !draft.brand ? null : await readDefaults(true);
  return startingTemplate({ draft, defaults, format: FORMAT[kind] });
}

/** Under the form's heading, once the default is in: what it is, and a way out for this poll only. */
export function defaultLine(name, useNone) {
  const at = $('.kind-switch') || $('#create h1');
  at?.insertAdjacentHTML(
    'afterend',
    `<p class="default-note" id="default-note">Using your default template, ${esc(name)}. <button type="button" class="link-btn" id="no-template">Use no template</button></p>`,
  );
  $('#no-template')?.addEventListener('click', () => {
    $('#default-note').remove();
    useNone();
    toast('This poll uses no template. Your default stays.');
  });
}

// ---------- My polls › Templates ----------

/** The two "start with" selects, for the account's templates (`brands`, as My polls lists them). */
export function defaultsHtml(brands, defs) {
  const select = (f, label) => {
    const on = defs?.[f]?.id;
    const opts = [['', 'No template (Venn’s look)'], ...brands.map((b) => [b.id, b.name])]
      .map(([id, name]) => `<option value="${esc(id)}"${(on || '') === id ? ' selected' : ''}>${esc(name)}</option>`)
      .join('');
    return `<label for="def-${f}">${label}</label><select id="def-${f}" data-format="${f}">${opts}</select>`;
  };
  return `<div class="acct-defaults">
      ${select('date', 'Date polls start with')}
      ${select('vote', 'Votes start with')}
      <p class="hint">Applies when you press Create a Venn while signed in. A template link you open, or a poll you’re already writing, always comes first.</p>
      <p class="error" id="def-err" role="alert"></p>
    </div>`;
}

/** Wire the selects: each saves as it changes; `saved(defs)` redraws the list with its pills. */
export function wireDefaults(root, defs, saved) {
  for (const sel of root.querySelectorAll('.acct-defaults select'))
    sel.onchange = async () => {
      const f = sel.dataset.format;
      const was = defs?.[f]?.id || '';
      $('#def-err', root).textContent = '';
      sel.disabled = true;
      try {
        const now = await setDefault(f, sel.value || null);
        toast(savedText(now, [f]));
        saved(now, sel.id);
      } catch (e) {
        sel.value = was;
        $('#def-err', root).textContent = e.message;
        sel.disabled = false;
        sel.focus();
      }
    };
}

// ---------- the template's own page ----------

/**
 * "Make it my default" (both formats) ⇄ "✓ Your default", on template `b`'s page, for an account
 * that can make polls with it. Shown once the defaults are known; not at all when they can't be.
 */
export async function defaultToggle(btn, b) {
  let defs = await readDefaults();
  if (!defs || !btn.isConnected) return;
  const draw = () => {
    const on = defaultFor(defs, b.id);
    // Only one of the two: half on.
    btn.setAttribute('aria-pressed', on.length === 2 ? 'true' : on.length ? 'mixed' : 'false');
    btn.textContent = on.length
      ? `✓ Your default${on.length === 1 ? ` for ${on[0] === 'date' ? 'date polls' : 'votes'}` : ''}`
      : 'Make it my default';
  };
  draw();
  btn.hidden = false;
  btn.onclick = async () => {
    // Both: off for both. Neither, or only one: on for both.
    if (btn.getAttribute('aria-busy') === 'true') return;
    const both = defaultFor(defs, b.id).length === 2;
    // Busy, not disabled: a disabled button drops the keyboard's focus.
    btn.setAttribute('aria-busy', 'true');
    try {
      for (const f of ['date', 'vote']) if (both || defs[f]?.id !== b.id) defs = await setDefault(f, both ? null : b.id);
      toast(savedText(defs, ['date', 'vote']));
    } catch (e) {
      toast(e.message);
    }
    btn.removeAttribute('aria-busy');
    draw();
  };
}
