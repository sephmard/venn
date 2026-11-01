// The deadline fields, on the create pages and in the organizer's Deadline panel: when answers close,
// and, when this server sends email, who to remind and how often (src/deadline.js). For organizers
// who are signed in (where the server has sign-in), and loaded only for them.

import { pad, utcToZoned, zonedToUtc } from './core.js';
import { $, esc, localTz } from './ui.js';

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

/** The fields, filled in with `d` ({ deadline, remindEvery, invitees }); reminders only when `email`. */
export function fields(d = {}, { email = true } = {}) {
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
        ? `<div id="dl-remind" class="stack-sm"${on ? '' : ' hidden'}>
      <div>
        <label for="dl-invitees">Remind who hasn't answered <span class="muted">(their emails)</span></label>
        <textarea id="dl-invitees" rows="3" placeholder="ana@example.com, lee@example.com" aria-describedby="dl-hint">${esc((d.invitees || []).map((i) => i.email ?? i).join(', '))}</textarea>
        <p class="hint" id="dl-hint">Only those who haven't answered get a reminder, with a one-tap stop.</p>
      </div>
      <div>
        <label for="dl-every">How often</label>
        <select id="dl-every">${EVERY.map(([n, label]) => `<option value="${n}"${n === every ? ' selected' : ''}>${label}</option>`).join('')}</select>
      </div>
    </div>`
        : ''
    }
  </div>`;
}

/** Reminders show once there's a deadline; a quick pick fills it in. `onInvitees` hears the emails change. */
export function wire({ onInvitees } = {}) {
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
  if (onInvitees) $('#dl-invitees')?.addEventListener('input', () => onInvitees(!!$('#dl-invitees').value.trim()));
  sync();
}

/** What to send: { deadline, remindEvery, invitees }, or { deadline: null } for none. */
export function values() {
  const v = $('#dl-at')?.value;
  if (!v) return { deadline: null };
  const [date, time] = v.split('T');
  const [h, m] = time.split(':').map(Number);
  // Pasted from anywhere ("Ana <ana@example.com>, lee@example.com"): just the addresses.
  const invitees = $('#dl-invitees')?.value.match(/[^\s,;<>"'()]+@[^\s,;<>"'()]+/g) || [];
  return { deadline: zonedToUtc(date, h * 60 + m, localTz), remindEvery: +($('#dl-every')?.value ?? 1), invitees };
}
