// "Add to your calendar", once the organizer has picked the date: Google Calendar, Outlook and iCal
// (the .ics file, which Apple Calendar and most other calendars open). The poll page loads this only
// when a date is picked, so it costs nothing before then.

import { buildIcs, googleCalendarUrl, outlookCalendarUrl } from './calendar-export.js';
import { esc } from './ui.js';

// Its styles come with it, so guests don't download them before there's a date.
// One quiet row: three small buttons, each its calendar's logo and short name.
const CSS = `.cal-add{margin-top:14px}.cal-add h3{font-size:0.95rem;margin:0 0 8px}.cal-add p{margin:-4px 0 8px;font-size:0.85rem}.cal-btns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.cal-btn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:8px 10px;border-radius:999px;background:var(--surface);color:var(--text);font-weight:700;font-size:0.95rem;text-decoration:none}.cal-btn svg{flex:none;width:20px;height:20px}.cal-btn:hover{background:var(--surface-2)}.cal-btn:focus-visible{outline:3px solid var(--yes-ink);outline-offset:2px}@media (max-width:374px){.cal-btn{flex-direction:column;gap:2px;padding:6px 4px;border-radius:16px;font-size:0.85rem}}`;

// Small calendar logos, drawn here so the page loads nothing from anyone else. The names say which is which.
const svg = (body) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">${body}</svg>`;
const LOGOS = {
  google: svg(
    '<path d="M6 2h12a4 4 0 0 1 4 4v11l-5 5H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="#4285f4"/><rect x="6" y="6" width="12" height="11" fill="#fff"/><path d="M6 17h11v5H6z" fill="#34a853"/><path d="M2 17h4v5a4 4 0 0 1-4-4z" fill="#fbbc04"/><path d="M17 22v-5h5z" fill="#ea4335"/><text x="12" y="15" text-anchor="middle" font-size="7.5" font-weight="700" fill="#4285f4" font-family="Arial,sans-serif">31</text>',
  ),
  outlook: svg(
    '<rect x="8" y="3" width="14" height="18" rx="2" fill="#28a8ea"/><rect x="2" y="6" width="12" height="12" rx="2" fill="#0f6cbd"/><ellipse cx="8" cy="12" rx="3" ry="3.6" fill="none" stroke="#fff" stroke-width="1.8"/>',
  ),
  // Apple's calendar shows the day of the month, so this one shows the picked day.
  ical: (day) =>
    svg(
      `<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#fff" stroke="#c7c7cc"/><path d="M2.5 7A4.5 4.5 0 0 1 7 2.5h10A4.5 4.5 0 0 1 21.5 7v1h-19z" fill="#ff3b30"/><text x="12" y="18.5" text-anchor="middle" font-size="10" font-weight="600" fill="#1c1c1e" font-family="system-ui,sans-serif">${+day}</text>`,
    ),
};

/**
 * The row of three buttons. `info` is what the calendar link helpers in core.js take ({ title, description,
 * location, start, end, allDay }); `day` is the picked day of the month, for the iCal logo.
 * Google and Outlook open in a new tab; iCal downloads the .ics, which opens the calendar app.
 */
let lastIcs = null;

export function addToCalendar({ id, info, day, url, guests = [] }) {
  if (!document.getElementById('cal-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'cal-css', textContent: CSS }));
  // Short names to fit three across a phone; screen readers hear the rest of the name too.
  const btn = (href, logo, name, more, tab = true) =>
    `<a class="cal-btn" href="${esc(href)}"${tab ? ' target="_blank" rel="noopener"' : ''}>${logo}<span>${name}${more ? `<span class="sr-only"> ${more}</span>` : ''}</span></a>`;
  // The organizer, when guests gave their email with their answer: Google Calendar and iCal invite
  // them. The iCal file is made here, so the emails (which only the organizer sees) never go in a link.
  const invite = guests.length > 0;
  if (lastIcs) URL.revokeObjectURL(lastIcs); // the file made the last time this was drawn
  lastIcs = invite
    ? URL.createObjectURL(new Blob([buildIcs({ ...info, id, url, attendees: guests })], { type: 'text/calendar' }))
    : null;
  const ics = lastIcs || `/api/events/${encodeURIComponent(id)}/event.ics`;
  const gcal = googleCalendarUrl({ ...info, guests: guests.map((g) => g.email) });
  return `<div class="cal-add" role="group" aria-labelledby="cal-add-h"${invite ? ' aria-describedby="cal-add-hint"' : ''}>
    <h3 id="cal-add-h">${invite ? 'Add it to your calendar, with your guests invited' : 'Add to your calendar'}</h3>
    ${
      invite
        ? `<p id="cal-add-hint">Google and Apple (iCal) invite the ${guests.length === 1 ? 'person who gave their email' : `${guests.length} people who gave their email`}.</p>`
        : ''
    }
    <div class="cal-btns">
      ${btn(gcal, LOGOS.google, 'Google', 'Calendar')}
      ${btn(outlookCalendarUrl(info), LOGOS.outlook, 'Outlook')}
      ${btn(ics, LOGOS.ical(day), 'Apple', 'Calendar (iCal)', false).replace('<a ', invite ? `<a download="${esc(id)}.ics" ` : '<a ')}
    </div>
  </div>`;
}
