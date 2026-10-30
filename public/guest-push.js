// A guest's "Notify me when the date is picked", under their answer. Loaded only when the server has
// notifications on (GET /api/config's push) and this device can show them; otherwise nothing shows.

import { api, esc, getConfig, save, saved, toast } from './ui.js';
import { currentSub, pushSupport, subscribe } from './push-client.js';

/** box: where it goes. ctx: { id, participantId, headers, picked (a date is set) } */
export async function guestPush(box, ctx) {
  const { id, participantId, headers, picked } = ctx;
  const key = (await getConfig()).push;
  if (!key || !pushSupport().supported || Notification.permission === 'denied' || !box.isConnected) return;
  const sub = await currentSub();
  const on = !!sub && saved(id).guestPush === sub.endpoint;
  const what = picked ? 'changes' : 'is picked';
  // A row of its own, under "Answering as …": the button, or that it's on and a way to stop it.
  box.innerHTML = on
    ? `<p class="hint"><span class="ok">🔔 You'll get a notification when the date ${esc(what)}.</span> <button type="button" class="link-btn" id="gp-off">Turn off</button></p>`
    : `<button type="button" class="btn btn-sm" id="gp-on">🔔 Notify me when the date ${esc(what)}</button>`;
  box.hidden = false;
  const path = `events/${id}/participants/${participantId}/push`;
  box.querySelector('button').onclick = async (e) => {
    e.target.disabled = true;
    try {
      if (on) {
        await api(path, { method: 'PUT', body: { pushRemove: sub.endpoint }, headers });
        save(id, { guestPush: null });
        toast('Notifications off');
      } else {
        const fresh = await subscribe(key);
        await api(path, { method: 'PUT', body: { push: fresh.toJSON() }, headers });
        save(id, { guestPush: fresh.endpoint });
        toast('Notifications on. A first one is on its way.');
      }
      guestPush(box, ctx);
    } catch (ex) {
      toast(ex.message);
      e.target.disabled = false;
    }
  };
}
