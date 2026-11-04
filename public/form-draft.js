// A half-made poll's draft, kept in this tab (sessionStorage) so a reload, the Back button or the
// Date / Vote switch never loses it. Loaded by the create forms once they're drawn (create.js
// keepDraft); what's safe to put back is decided in drafts.js.

import { cleanFormDraft, dropStored, formDraftHasWork, formDraftKey, readStored, writeStored } from './drafts.js';
import { $ } from './ui.js';

let kind = null; // 'free' or 'topic' while a form keeps a draft
let own = null; // the form's own part of the draft (its picks, or its options)
let shared = null; // { privacy, seeded, quietly } from create.js
let queued = false;
let restoring = false;
let page = null; // the page the form is on: once it's left, its form is on its way out

/** Stop keeping a draft (another form is drawn). */
export function stop() {
  kind = null;
}

/** The poll is made: forget its draft, and keep no more of this form. */
export function drop() {
  if (kind) dropStored(sessionStorage, formDraftKey(kind));
  kind = null;
}

/** Keep the draft, once the change in hand has been handled. */
export function changed() {
  if (!kind || restoring || queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    // Typed into a form whose page was just left (its next one still loading): not this draft's.
    if (!kind || restoring || !$('#create') || location.pathname !== page) return;
    const pressed = $('[data-occasion][aria-pressed="true"]');
    writeStored(sessionStorage, formDraftKey(kind), {
      title: shared.seeded() ? '' : $('#title').value,
      occasion: pressed ? +pressed.dataset.occasion : null,
      location: $('#location').value,
      desc: $('#desc').value,
      organizer: $('#organizer').value,
      privacy: shared.privacy.map(([, el]) => $(el).checked),
      brand: shared.brand?.() || null,
      ...own(),
    });
  });
}

/** Keep this form's draft from now on, after putting back the last one (if it has any work in it). */
export async function keep(k, ownPart, putBack, sharedParts) {
  [kind, own, shared, page] = [k, ownPart, sharedParts, location.pathname];
  const form = $('#create');
  if (!form) return (kind = null);
  for (const type of ['input', 'change', 'click']) form.addEventListener(type, changed);
  const d = cleanFormDraft(readStored(sessionStorage, formDraftKey(k)), new Date().toLocaleDateString('en-CA'));
  if (!formDraftHasWork(d)) return;
  restoring = true;
  try {
    const tpl = d.occasion != null && $(`[data-occasion="${d.occasion}"]`);
    if (tpl) {
      shared.quietly(true); // the draft has its own name and note
      tpl.click();
      shared.quietly(false);
    }
    if (d.title) $('#title').value = d.title;
    $('#location').value = d.location;
    $('#desc').value = d.desc;
    $('#more-box').open = !!(d.location || d.desc);
    if (d.organizer) $('#organizer').value = d.organizer;
    shared.privacy.forEach(([, el], i) => ($(el).checked = !!d.privacy[i]));
    $('#privacy-opts').open = d.privacy.some(Boolean);
    await putBack(d);
  } finally {
    restoring = false;
  }
  if (!form.isConnected) return;
  $('#title').dispatchEvent(new Event('input'));
  // Said once, quietly, with a way to start again; it goes at the first change.
  ($('.kind-switch') || $('#create h1')).insertAdjacentHTML(
    'afterend',
    `<p class="draft-note" id="draft-note">${d.fromAi ? 'Made into a vote. Check the options.' : 'Picked up where you left off.'} <button type="button" class="link-btn" id="draft-reset">Start over</button></p>`,
  );
  $('#draft-reset').onclick = () => {
    drop();
    location.reload();
  };
  const gone = (e) => {
    if (!e.isTrusted || e.target.closest?.('#draft-note')) return;
    $('#draft-note')?.remove();
    for (const t of ['input', 'click']) form.removeEventListener(t, gone);
  };
  for (const t of ['input', 'click']) form.addEventListener(t, gone);
}
