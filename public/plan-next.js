// Plans that come round again (book clubs, run clubs, game nights), on the poll page, for the
// organizer only:
//  - once the date is set, "Plan next month's" (or next week's, or the one in 2 weeks), which opens
//    the create page with this poll's dates moved on (repeat.js), and how often it repeats;
//  - on the next poll, a way to bring last time's group back: an email to them all, in BCC, when
//    last time's poll asked for emails, and the link to share.
// Loaded by event.js only when there's one of these to show.

import { $, api, esc, plural, saved, toast } from './ui.js';
import { REPEATS, groupMail, nextLabel } from './repeat.js';

const CSS = `
#plan-next{display:inline-flex;flex-wrap:wrap;align-items:center;gap:0 16px}
#plan-next .pn-repeat{display:inline-flex;align-items:center;gap:8px;font-weight:600}
#plan-next select{width:auto;min-height:44px;padding:8px 12px}
.series-box{margin-bottom:16px}
.series-box h2{margin:0 0 4px}
.series-box p{margin:0 0 12px}
.series-box .btn-row{margin-top:0}
`;

const CHOICES = [
  ['weekly', 'Every week'],
  ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Every month'],
  ['', 'Doesn’t repeat'],
];

/** What the link says for each choice: "Plan next month’s", or a plain copy when it doesn't repeat. */
export const planLabel = (repeat) =>
  REPEATS.includes(repeat) ? `Plan ${repeat === 'biweekly' ? 'the one in 2 weeks' : nextLabel(repeat)}` : 'Plan the next one';

/** The create page for the next one: a copy of poll `id`, moved on by `repeat` when it repeats. */
export const planHref = (kind, id, repeat) =>
  `/new/${kind}?copy=${encodeURIComponent(id)}${REPEATS.includes(repeat) ? `&next=${repeat}` : ''}`;

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

export async function planNext({ id, ev, headers, kind }) {
  if (!document.getElementById('plan-next-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'plan-next-css', textContent: CSS }));

  const box = $('#plan-next');
  if (box) {
    // A plan that repeats suggests its own next one; others suggest next month's, the usual for a club.
    const pick = (repeat) => {
      const a = box.querySelector('a');
      a.textContent = planLabel(repeat);
      a.href = planHref(kind, id, repeat);
    };
    const current = ev.repeat || 'monthly';
    box.innerHTML = `<a class="link-btn" data-link></a>
      <span class="pn-repeat"><label for="repeat-sel">Repeats</label>
      <select id="repeat-sel">${CHOICES.map(([v, label]) => `<option value="${v}"${v === current ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></span>`;
    pick(current);
    // The choice is saved with the poll: its organizer gets a "time to plan the next one?" email.
    $('#repeat-sel').onchange = async (e) => {
      const repeat = e.target.value;
      pick(repeat);
      try {
        await api(`events/${id}/settings`, { method: 'PUT', body: { repeat }, headers });
        ev.repeat = repeat || undefined;
        toast(repeat ? `Saved: ${CHOICES.find(([v]) => v === repeat)[1].toLowerCase()}` : 'Saved: it doesn’t repeat');
      } catch (ex) {
        toast(ex.message);
      }
    };
  }

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
