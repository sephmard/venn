// The deadline fields, on the create page and in the organizer's Privacy panel: when answers close,
// and, when this server sends email, who to remind and how often (src/deadline.js). Only polls that
// ask everyone for their email have them, and this loads when they're first wanted.

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

/** The fields, filled in with `d` ({ deadline, remindEvery, invitees }); reminders only when `email`. */
export function fields(d = {}, { email = true } = {}) {
  const on = d.deadline != null;
  const every = d.remindEvery ?? 1;
  return `<div class="deadline-fields stack-sm">
    <div>
      <label for="dl-at">Answers close <span class="muted">(optional)</span></label>
      <input id="dl-at" type="datetime-local" value="${on ? local(d.deadline) : ''}" min="${local(Date.now() + HOUR)}" max="${local(Date.now() + 30 * 24 * HOUR)}">
    </div>
    ${
      email
        ? `<div id="dl-remind" class="stack-sm"${on ? '' : ' hidden'}>
      <div>
        <label for="dl-invitees">Remind who you invited <span class="muted">(emails)</span></label>
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

/** Reminders show once there's a deadline. */
export function wire() {
  const at = $('#dl-at');
  at.addEventListener('input', () => {
    if ($('#dl-remind')) $('#dl-remind').hidden = !at.value;
  });
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
