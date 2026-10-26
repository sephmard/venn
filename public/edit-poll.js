// Editing or duplicating a poll from the create pages: ?edit=<id> changes that poll (only while
// nobody else has answered), ?copy=<id> starts a new poll from it, with any dates that have passed
// dropped or moved on, and ?copy=<id>&next=monthly (or weekly, biweekly) starts the next one of a
// plan that repeats, its dates moved on (repeat.js). Only loaded for those links.

import { $, api, saved, toast, tzOptions } from './ui.js';
import { REPEATS, freshPoll, groupMail, nextCycle, nextLabel } from './repeat.js';

/** How often the plan being copied repeats (?next=), or ''. */
const next = () => {
  const v = new URLSearchParams(location.search).get('next');
  return REPEATS.includes(v) ? v : '';
};

let copied = null; // the poll being copied, as it was loaded

/** The poll to start from, with the organizer's view of it when this device has their link. */
export async function loadSource(src) {
  const token = saved(src.id).adminToken;
  let ev;
  try {
    ev = await api(`events/${src.id}`, { headers: token ? { 'x-admin-token': token } : {} });
  } catch (ex) {
    toast(ex.message);
    return null;
  }
  if (src.edit) return ev;
  copied = ev;
  // A copy is for a new plan: never dates that have been and gone.
  return next() ? nextCycle(ev, next()) : freshPoll(ev);
}

/** What a new poll copied with ?next= keeps: how often it repeats, and the poll it follows on from. */
export const seriesFields = () => (next() && copied ? { repeat: next(), seriesOf: copied.id } : {});

/**
 * For the celebration once the next one is made: an email to everyone who gave their email last
 * time (only the organizer sees them, so only with their link on this device), or null.
 */
export function inviteLast(url, title) {
  if (!next() || !copied?.isAdmin) return null;
  const href = groupMail(
    copied.participants.filter((p) => p.id !== copied.hostId && p.email).map((p) => p.email),
    title,
    url,
  );
  return href ? { label: 'Email last time’s group', href } : null;
}

/**
 * Fill in everything both kinds of poll share: the plan, the organizer and the privacy options.
 * `occasions` are the kinds of plan, `privacy` the [setting, switch] pairs, `showTz` shows the time zone.
 * `icon` (poll-image.js) takes the poll's own emoji and picture: an edit keeps them, and a copy gets
 * the same picture uploaded again, with a link-preview card for its own name.
 */
export function fillCommon(ev, src, { occasions, privacy, showTz, icon }) {
  const i = occasions.findIndex((o) => o.emoji === ev.emoji);
  if (i >= 0) $(`[data-occasion="${i}"]`).click();
  icon?.restore(ev, src, i < 0);
  $('#title').value = ev.title;
  $('#location').value = ev.location || '';
  $('#desc').value = ev.description || '';
  $('#more-box').open = !!(ev.location || ev.description);
  $('#organizer').value = ev.organizer || '';
  // Times are in the organizer's time zone (everyone sees them in their own); a poll keeps its own.
  if (ev.timezone) {
    $('#tz').innerHTML = tzOptions(ev.timezone);
    showTz();
  }
  for (const [key, el] of privacy) $(el).checked = !!ev[key];
  $('#privacy-opts').open = privacy.some(([key]) => ev[key]);
  if (src.edit) {
    $('#create h1').textContent = 'Edit your poll';
    $('#create .back').textContent = '‹ Back to the poll';
    $('#create .back').setAttribute('href', `/e/${src.id}`);
    $('#submit').textContent = 'Save changes';
    $('#notify-field').remove(); // notifications have their own panel on the poll
    $('#notify-off').remove();
  } else if (next()) {
    $('#create h1').textContent = `Plan ${nextLabel(next())}`;
    toast('Same again, with the dates moved on. Check them, then create the poll.');
  } else toast('Copied. Change anything you like, then create the new poll.');
}

/**
 * Save the changes to a poll nobody else has answered yet, and go back to it. Its picture is saved
 * again too (`icon`, poll-image.js), so the link-preview card has the poll's new name.
 */
export async function saveEdit(id, body, icon) {
  try {
    await api(`events/${id}`, { method: 'PUT', body, headers: { 'x-admin-token': saved(id).adminToken || '' } });
    await icon?.upload(id, saved(id).adminToken || '', body.title);
    history.pushState(null, '', `/e/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
    scrollTo(0, 0);
    toast('Poll updated');
  } catch (ex) {
    $('#err').textContent = ex.message;
    $('#submit').disabled = false;
  }
}
