// "Add to your calendar", once the organizer has picked the date: Google Calendar, Outlook and iCal
// (the .ics file, which Apple Calendar and most other calendars open). The poll page loads this only
// when a date is picked, so it costs nothing before then.

import { googleCalendarUrl, outlookCalendarUrl } from './core.js';
import { esc } from './ui.js';

// Its styles come with it, so guests don't download them before there's a date.
const CSS = `.cal-add{margin-top:16px}.cal-add h3{font-size:1.05rem;margin:0}.cal-add p{margin:2px 0 10px;font-size:0.9rem}.cal-btns{display:grid;grid-template-columns:repeat(auto-fit, minmax(170px, 1fr));gap:8px}.cal-btn{display:flex;align-items:center;gap:10px;min-height:52px;padding:10px 16px;border-radius:var(--radius);background:var(--surface);color:var(--text);font-weight:700;text-decoration:none;box-shadow:var(--lift)}.cal-btn svg{flex:none}.cal-go{margin-left:auto;color:var(--muted);font-weight:600}.cal-btn:hover{background:var(--surface-2)}.cal-btn:focus-visible{outline:3px solid var(--yes-ink);outline-offset:2px}`;

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
 * The group of three buttons. `info` is what the calendar link helpers in core.js take ({ title, description,
 * location, start, end, allDay }); `day` is the picked day of the month, for the iCal logo.
 * Google and Outlook open in a new tab; iCal downloads the .ics, which opens the calendar app.
 */
export function addToCalendar({ id, info, day }) {
  if (!document.getElementById('cal-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'cal-css', textContent: CSS }));
  const btn = (href, logo, name, tab = true) =>
    `<a class="cal-btn" href="${esc(href)}"${tab ? ' target="_blank" rel="noopener"' : ''}>${logo}<span>${name}</span><span class="cal-go" aria-hidden="true">${tab ? '↗' : '↓'}</span></a>`;
  return `<div class="cal-add" role="group" aria-labelledby="cal-add-h" aria-describedby="cal-add-hint">
    <h3 id="cal-add-h">Add to your calendar</h3>
    <p id="cal-add-hint">Opens your calendar with the event filled in. iCal works with Apple Calendar and most others.</p>
    <div class="cal-btns">
      ${btn(googleCalendarUrl(info), LOGOS.google, 'Google Calendar')}
      ${btn(outlookCalendarUrl(info), LOGOS.outlook, 'Outlook')}
      ${btn(`/api/events/${encodeURIComponent(id)}/event.ics`, LOGOS.ical(day), 'iCal', false)}
    </div>
  </div>`;
}
