// The next one of a plan (book clubs, run clubs, game nights), on the poll page, for its organizer:
// when it was planned from last time's poll ("Plan the next one", which copies it with its dates
// moved on), a way to bring last time's group back: an email to them all, in BCC, when last time's
// poll asked for emails, and the link to share. Loaded by event.js only when there's one to show.

import { $, api, esc, plural, saved } from './ui.js';
import { groupMail } from './copy-poll.js';

const CSS = `
.series-box{margin-bottom:16px}
.series-box h2{margin:0 0 4px}
.series-box p{margin:0 0 12px}
.series-box .btn-row{margin-top:0}
`;

/** Last time's poll, as its organizer sees it (with emails), when this device has its organizer link. */
const previous = new Map();
export function lastTime(prevId) {
  if (!previous.has(prevId)) {
    const token = saved(prevId).adminToken;
    previous.set(
      prevId,
      api(`events/${prevId}`, { headers: token ? { 'x-admin-token': token } : {} }).then(
        (ev) => {
          const guests = ev.participants.filter((p) => p.id !== ev.hostId);
          return { title: ev.title, people: ev.responses ?? guests.length, emails: guests.map((p) => p.email).filter(Boolean) };
        },
        () => null,
      ),
    );
  }
  return previous.get(prevId);
}

export async function planNext({ id, ev }) {
  if (!document.getElementById('plan-next-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'plan-next-css', textContent: CSS }));

  const series = $('#series-box');
  if (series && ev.seriesOf) {
    const last = await lastTime(ev.seriesOf);
    if (!last?.people || !$('#series-box')) return;
    const mail = groupMail(last.emails, ev.title, `${location.origin}/e/${id}`);
    $('#series-box').innerHTML = `<section class="sheet series-box" aria-labelledby="series-h">
      <h2 id="series-h">Bring the group back</h2>
      <p>${esc(plural(last.people, 'person', 'people'))} answered “${esc(last.title)}” last time. Send them this one.</p>
      <div class="btn-row">
        ${mail ? `<a class="btn btn-primary" id="email-group" href="${esc(mail)}">Email last time’s group</a>` : ''}
        <button type="button" class="btn${mail ? '' : ' btn-primary'}" data-share>Share the link</button>
      </div>
    </section>`;
  }
}
