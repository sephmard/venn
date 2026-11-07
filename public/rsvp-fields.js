// An RSVP's guest list settings, as fields: spots (with a waitlist once they're taken), plus-ones,
// and approving each RSVP. The create form (create-rsvp.js) and the organizer's panel
// (rsvp-organizer.js) share them.

import { $ } from './ui.js';

const MAX_PLUS = 5;

/** The guest list's fields: the create form (create-rsvp.js) and the organizer's panel share them. */
export const fields = ({ cap = null, plusOnes = 0, approve = false } = {}) => `
  <label class="switch"><input type="checkbox" role="switch" id="r-cap-on"${cap != null ? ' checked' : ''}> Limit spots</label>
  <div class="rsvp-cap" id="r-cap-row"${cap != null ? '' : ' hidden'}>
    <label for="r-cap">Spots</label>
    <input id="r-cap" type="number" inputmode="numeric" min="1" max="1000" value="${cap ?? 10}">
    <p class="hint">Once they’re taken, new RSVPs join a waitlist.</p>
  </div>
  <label class="switch"><input type="checkbox" role="switch" id="r-plus-on"${plusOnes ? ' checked' : ''}> Plus-ones</label>
  <div class="rsvp-cap" id="r-plus-row"${plusOnes ? '' : ' hidden'}>
    <label for="r-plus">Up to</label>
    <select id="r-plus">${Array.from({ length: MAX_PLUS }, (_, i) => `<option value="${i + 1}"${i + 1 === (plusOnes || 1) ? ' selected' : ''}>+${i + 1} each</option>`).join('')}</select>
  </div>
  <label class="switch"><input type="checkbox" role="switch" id="r-approve"${approve ? ' checked' : ''}> Approve each RSVP</label>`;

/** The switches show their fields. */
export function wireFields(root = document) {
  for (const [on, row] of [
    ['#r-cap-on', '#r-cap-row'],
    ['#r-plus-on', '#r-plus-row'],
  ])
    $(on, root).addEventListener('change', (e) => ($(row, root).hidden = !e.target.checked));
}

/** The settings as the API takes them: { cap, plusOnes, approve }. */
export const values = (root = document) => ({
  cap: $('#r-cap-on', root).checked ? Number($('#r-cap', root).value) : null,
  plusOnes: $('#r-plus-on', root).checked ? Number($('#r-plus', root).value) : 0,
  approve: $('#r-approve', root).checked,
});
