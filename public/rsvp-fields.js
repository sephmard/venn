// An RSVP's guest list settings, as fields: spots (with a waitlist once they're taken), plus-ones,
// and approving each RSVP. The create form (create-rsvp.js) and the organizer's panel
// (rsvp-organizer.js) share them.

import { $ } from './ui.js';

const MAX_PLUS = 5;

/** A switch with a number beside it once it's on: the Days in a row row of /new (styles.css). */
const row = ({ id, label, name, on, value, min, max, fewer, more }) => `
  <div class="inline-field inline-row">
    <label class="switch"><input type="checkbox" role="switch" id="${id}-on"${on ? ' checked' : ''}> ${label}</label>
    <div class="stepper" id="${id}-row"${on ? '' : ' hidden'}>
      <button type="button" class="icon-btn" data-rstep="-1" aria-label="${fewer}">−</button>
      <input id="${id}" type="number" min="${min}" max="${max}" value="${value}" inputmode="numeric" aria-label="${name}">
      <button type="button" class="icon-btn" data-rstep="1" aria-label="${more}">+</button>
    </div>
  </div>`;

/** The guest list's fields: the create form (create-rsvp.js) and the organizer's panel share them. */
export const fields = ({ cap = null, plusOnes = 0, approve = false } = {}) =>
  row({
    id: 'r-cap',
    label: 'Limit spots',
    name: 'Spots',
    on: cap != null,
    value: cap ?? 10,
    min: 1,
    max: 1000,
    fewer: 'One spot fewer',
    more: 'One spot more',
  }) +
  row({
    id: 'r-plus',
    label: 'Plus-ones',
    name: 'Plus-ones each',
    on: !!plusOnes,
    value: plusOnes || 1,
    min: 1,
    max: MAX_PLUS,
    fewer: 'One fewer each',
    more: 'One more each',
  }) +
  `<div class="inline-field"><label class="switch"><input type="checkbox" role="switch" id="r-approve"${approve ? ' checked' : ''}> Approve each RSVP</label></div>`;

const stepping = new WeakSet();
/** The switches show their numbers, and − and + step them within their limits. */
export function wireFields(root = document) {
  for (const id of ['r-cap', 'r-plus'])
    $(`#${id}-on`, root).addEventListener('change', (e) => ($(`#${id}-row`, root).hidden = !e.target.checked));
  if (stepping.has(root)) return; // the fields are redrawn inside the same form: one listener is enough
  stepping.add(root);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rstep]');
    const input = b?.parentElement.querySelector('input');
    if (!input) return;
    const n = Math.round(Number(input.value) || 0) + Number(b.dataset.rstep);
    input.value = Math.max(Number(input.min), Math.min(Number(input.max), n));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The settings as the API takes them: { cap, plusOnes, approve }. */
export const values = (root = document) => ({
  cap: $('#r-cap-on', root).checked ? Number($('#r-cap', root).value) : null,
  plusOnes: $('#r-plus-on', root).checked ? Number($('#r-plus', root).value) : 0,
  approve: $('#r-approve', root).checked,
});
