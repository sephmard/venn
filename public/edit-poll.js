// Editing or duplicating a poll from the create pages: ?edit=<id> changes that poll (only while
// nobody else has answered), ?copy=<id> starts a new poll from it. Only loaded for those links.

import { $, api, saved, toast, tzOptions } from './ui.js';

/** The poll to start from, with the organizer's view of it when this device has their link. */
export async function loadSource(src) {
  const token = saved(src.id).adminToken;
  try {
    return await api(`events/${src.id}`, { headers: token ? { 'x-admin-token': token } : {} });
  } catch (ex) {
    toast(ex.message);
    return null;
  }
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
