// The deadline fields, on the create pages and in the organizer's Deadline panel: when answers close,
// and, when this server sends email, how often to remind who hasn't answered (src/deadline.js). For organizers
// who are signed in (where the server has sign-in), and loaded only for them.

import { pad, utcToZoned, zonedToUtc } from './core.js';
import { $, localTz } from './ui.js';

const EVERY = [
  [1, 'Every day'],
  [2, 'Every 2 days'],
  [3, 'Every 3 days'],
  [0, 'Only the day before'],
];
const HOUR = 3_600_000;
/** An instant as a datetime-local value, on this device's clock. */
const local = (ms) => {
  const { date, minutes } = utcToZoned(ms, localTz);
  return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
};

/** Quick picks for when answers close: that many days from now, at 6 PM. */
const SOON = [
  [1, 'Tomorrow'],
  [3, 'In 3 days'],
  [7, 'In a week'],
];
const soon = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(18, 0, 0, 0);
  return local(d.getTime());
};

/**
 * The fields, filled in with `d` ({ deadline, remindEvery }). Reminders only when `email`; they go
 * to the people the poll is emailed to (invite-fields.js), so they show once there are some
 * (`invitees`, or setInvitees); until then `none` says how to add them.
 */
export function fields(
  d = {},
  { email = true, invitees = 0, none = 'Add people under “Email it to people” to remind who hasn’t answered.' } = {},
) {
  const on = d.deadline != null;
  const every = d.remindEvery ?? 1;
  return `<div class="deadline-fields stack-sm">
    <div>
      <label for="dl-at">Answers close</label>
      <div class="dl-soon" role="group" aria-label="Quick picks" style="display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px">${SOON.map(
        ([n, label]) => `<button type="button" class="pill" data-soon="${n}" aria-pressed="false">${label}</button>`,
      ).join('')}</div>
      <input id="dl-at" type="datetime-local" value="${on ? local(d.deadline) : ''}" min="${local(Date.now() + HOUR)}" max="${local(Date.now() + 30 * 24 * HOUR)}">
    </div>
    ${
      email
        ? `<div id="dl-remind" class="stack-sm" data-invitees="${invitees}"${on ? '' : ' hidden'}>
      <div id="dl-every-box"${invitees ? '' : ' hidden'}>
        <label for="dl-every">Remind who hasn't answered</label>
        <select id="dl-every" aria-describedby="dl-hint">${EVERY.map(([n, label]) => `<option value="${n}"${n === every ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <p class="hint" id="dl-hint">Goes to the people you emailed it to, with a one-tap stop.</p>
      </div>
      ${none ? `<p class="hint" id="dl-none"${invitees ? ' hidden' : ''}>${none}</p>` : ''}
    </div>`
        : ''
    }
  </div>`;
}

/** How many the poll is emailed to: reminders show once there's someone. */
export function setInvitees(n) {
  const box = $('#dl-remind');
  if (!box) return;
  box.dataset.invitees = n;
  $('#dl-every-box').hidden = !n;
  if ($('#dl-none')) $('#dl-none').hidden = !!n;
}

/** Reminders show once there's a deadline; a quick pick fills it in. */
export function wire() {
  const at = $('#dl-at');
  const sync = () => {
    if ($('#dl-remind')) $('#dl-remind').hidden = !at.value;
    for (const b of document.querySelectorAll('[data-soon]'))
      b.setAttribute('aria-pressed', String(!!at.value && at.value === soon(+b.dataset.soon)));
  };
  at.addEventListener('input', sync);
  for (const b of document.querySelectorAll('[data-soon]'))
    b.onclick = () => {
      at.value = at.value === soon(+b.dataset.soon) ? '' : soon(+b.dataset.soon);
      sync();
    };
  sync();
}

/** What to send: { deadline, remindEvery }, or { deadline: null } for none. */
export function values() {
  const v = $('#dl-at')?.value;
  if (!v) return { deadline: null };
  const [date, time] = v.split('T');
  const [h, m] = time.split(':').map(Number);
  return { deadline: zonedToUtc(date, h * 60 + m, localTz), remindEvery: +($('#dl-every')?.value ?? 1) };
}
