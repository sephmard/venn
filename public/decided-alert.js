// A vote guest's "Tell me when it's decided", under their answer once it's in (topic-poll.js): one
// email when the organizer picks, or a notification on this device. Shown only where the server
// can send one; loaded only then, so the vote's page doesn't carry it.

import { isEmail } from './core.js';
import { $, api, esc, getConfig, lastEmail, rememberEmail, toast } from './ui.js';

const CSS = `
.tell-me{margin-top:12px}
.tell-me form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tell-me label{flex-basis:100%;font-weight:600}
.tell-me input{flex:1 1 220px;min-width:0;font-size:16px;min-height:44px}
.tell-me .btn{min-height:44px}
@media (max-width:699px){.tell-me form .btn{flex-basis:100%}}
.tell-me .hint{margin:6px 0 0}
`;

/**
 * box: where it goes. ctx: { id, participantId, headers (the guest's own), email (theirs, if the
 * poll has one), required (the poll asks everyone for an email) }.
 */
export async function decidedAlert(box, ctx) {
  const config = await getConfig();
  const pushCtx = { id: ctx.id, participantId: ctx.participantId, headers: ctx.headers, topic: true };
  // Email off: the notification button is all there is, where this device can show one.
  if (!config.emailAvailable) {
    if (config.push) import('./guest-push.js').then((m) => m.guestPush(box, pushCtx)).catch(() => {});
    return;
  }
  if (!document.getElementById('tell-me-css')) {
    const style = document.createElement('style');
    style.id = 'tell-me-css';
    style.textContent = CSS;
    document.head.append(style);
  }
  let email = ctx.email || null;
  const path = `events/${ctx.id}/participants/${ctx.participantId}`;
  const save = (value) => api(path, { method: 'PUT', body: { email: value }, headers: ctx.headers });

  // A: the offer. B: asking for an email. C: it's on.
  const offer = () => {
    box.innerHTML = `<button type="button" class="btn btn-sm" id="tm-on">🔔 Tell me when it's decided</button>`;
    $('#tm-on', box).onclick = ask;
  };
  const on = () => {
    box.innerHTML = `<p class="hint"><span class="ok">✓ You'll get one email at ${esc(email)} when it's decided.</span>${
      ctx.required ? '' : ' <button type="button" class="link-btn" id="tm-off">Turn off</button>'
    }</p>`;
    const off = $('#tm-off', box);
    if (off)
      off.onclick = async () => {
        off.disabled = true;
        try {
          await save('');
          email = null;
          offer();
          $('#tm-on', box).focus();
          toast('Okay, no email.');
        } catch (ex) {
          toast(ex.message);
          off.disabled = false;
        }
      };
  };
  function ask() {
    box.innerHTML = `<form novalidate>
        <label for="tm-email">Email me when it's decided</label>
        <input id="tm-email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${esc(lastEmail())}">
        <button type="submit" class="btn btn-sm">Email me</button>
      </form>
      <p class="hint">One email when the organizer picks. They can see your address.${
        config.push ? ' <button type="button" class="link-btn" id="tm-push">Use a notification instead</button>' : ''
      }</p>
      <p class="error" id="tm-err" role="alert"></p>`;
    const input = $('#tm-email', box);
    input.focus();
    box.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const value = input.value.trim();
      const err = $('#tm-err', box);
      err.textContent = '';
      if (!isEmail(value.toLowerCase())) return ((err.textContent = "That email doesn't look right."), input.focus());
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        await save(value);
        email = value.toLowerCase();
        rememberEmail(value);
        on();
        ($('#tm-off', box) || box).focus?.();
        toast("Done. One email when it's decided.");
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
      }
    };
    input.onkeydown = (e) => {
      if (e.key !== 'Escape') return;
      offer();
      $('#tm-on', box).focus();
    };
    const push = $('#tm-push', box);
    if (push)
      push.onclick = () => import('./guest-push.js').then((m) => m.guestPush(box, { ...pushCtx, focus: true })).catch(() => {});
  }

  if (email) on();
  else offer();
  box.hidden = false;
}
