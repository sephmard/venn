// Adding a picked date to someone's calendar: an .ics file (Apple Calendar and most others), and
// links that open Google Calendar or Outlook with the event filled in. Used by the server for the
// .ics download and by add-to-calendar.js, which the poll page loads once a date is picked.

function icsStamp(ms) {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function icsEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[,;]/g, (c) => '\\' + c);
}

const icsDate = (d) => d.replace(/-/g, '');

/**
 * Pass `allDay` ({startDate, endDate} from allDaySpan) to make an all-day event, and `attendees`
 * ([{ name, email }]) to invite people: the organizer's copy, when the poll asked everyone's email.
 * `image` ({ url, type }) is the poll's own picture, which calendars that support it (RFC 7986) show
 * as the event's badge; the description keeps the poll's link either way.
 */
export function buildIcs({ id, title, description, start, end, url, allDay, location, attendees = [], image = null }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Venn//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${id}-${start}@venn`,
    `DTSTAMP:${icsStamp(Date.now())}`,
    ...(allDay
      ? [`DTSTART;VALUE=DATE:${icsDate(allDay.startDate)}`, `DTEND;VALUE=DATE:${icsDate(allDay.endDate)}`]
      : [`DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`]),
    `SUMMARY:${icsEscape(title)}`,
  ];
  const desc = [description, url].filter(Boolean).join('\n\n');
  if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (url) lines.push(`URL:${url}`);
  if (image?.url) lines.push(`IMAGE;VALUE=URI;DISPLAY=BADGE;FMTTYPE=${image.type || 'image/jpeg'}:${image.url}`);
  // A name goes in quotes, so it can't carry its own quotes or line breaks.
  for (const a of attendees)
    lines.push(
      `ATTENDEE;CN="${String(a.name).replace(/["\r\n\\]/g, '')}";ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${String(a.email).replace(/[\s"]/g, '')}`,
    );
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** `guests` (emails) are added to the event as guests, for Google Calendar to invite. */
export function googleCalendarUrl({ title, description, start, end, allDay, location, guests = [] }) {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: allDay ? `${icsDate(allDay.startDate)}/${icsDate(allDay.endDate)}` : `${icsStamp(start)}/${icsStamp(end)}`,
    details: description || '',
  });
  if (location) q.set('location', location);
  if (guests.length) q.set('add', guests.join(','));
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function outlookCalendarUrl({ title, description, start, end, allDay, location }) {
  const q = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    body: description || '',
    startdt: allDay ? allDay.startDate : new Date(start).toISOString(),
    enddt: allDay ? allDay.endDate : new Date(end).toISOString(),
  });
  if (allDay) q.set('allday', 'true');
  if (location) q.set('location', location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q}`;
}
