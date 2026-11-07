// /new/rsvp: the date is already picked, and the organizer wants to know who's coming. They set
// the date and time, and the guest list's rules (spots with a waitlist, plus-ones, approval).
// Shares the create pages' parts (create.js).

import { addDays, allDaySpan, utcToZoned, zonedToUtc } from './core.js';
import {
  createBar,
  draftChanged,
  explainNotReady,
  fillCommon,
  keepDraft,
  kindSwitch,
  loadSource,
  nameAndEmail,
  planFields,
  prefillTitle,
  setReady,
  showConfig,
  source,
  startForm,
  submit,
  tzLine,
  wirePlan,
  youFields,
} from './create.js';
import { fields, values, wireFields } from './rsvp-fields.js';
import { $, app, localTz, todayStr, track } from './ui.js';

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const minutes = (v) => {
  const [h, m] = (v || '').split(':').map(Number);
  return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
};

/** The next Saturday (today if it is one), for a first guess at the date. */
function nextSaturday() {
  const today = todayStr();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, (6 - dow + 7) % 7);
}

/**
 * The event's start and end in UTC milliseconds, from the form's date and times in time zone `tz`:
 * all day runs midnight to midnight; an end at or before the start is the next day. null if unset.
 */
export function eventTimes({ date, allDay, from, to }, tz) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  if (allDay) return { start: zonedToUtc(date, 0, tz), end: zonedToUtc(addDays(date, 1), 0, tz) };
  if (from == null) return null;
  const until = to ?? from + 120;
  const endDate = until <= from ? addDays(date, 1) : date;
  return { start: zonedToUtc(date, from, tz), end: zonedToUtc(endDate, until % 1440, tz) };
}

export function renderRsvpForm() {
  document.title = 'Create a Venn';
  const src = source();
  if (!src?.edit) track('view', { page: 'rsvp' });
  startForm();

  app.innerHTML = `
    <form id="create" class="create rsvp-create" novalidate>
      <a class="back" href="/" hidden>‹ Back</a>
      <h1>Create a Venn</h1>
      ${src ? '' : kindSwitch('rsvp')}
      ${planFields('rsvp')}
      <section class="sheet" aria-labelledby="when-h">
        <h2 id="when-h">When is it?</h2>
        <div class="rsvp-when-fields">
          <div class="rsvp-date"><label for="r-date">Date</label><input id="r-date" type="date" value="${nextSaturday()}" min="${todayStr()}"></div>
          <div class="rsvp-time" id="r-times">
            <div><label for="r-from">Starts</label><input id="r-from" type="time" value="19:00" step="300"></div>
            <div><label for="r-to">Ends</label><input id="r-to" type="time" value="21:00" step="300"></div>
          </div>
        </div>
        <label class="switch"><input type="checkbox" role="switch" id="r-allday"> All day</label>
      </section>
      <section class="sheet" aria-labelledby="guests-h">
        <h2 id="guests-h">Guest list</h2>
        <div class="rsvp-settings">${fields()}</div>
      </section>
      ${youFields()}
      ${tzLine()}
      ${createBar('Create a Venn')}
    </form>`;
  $('#title').placeholder = 'Summer party';
  $('#emoji-tile').textContent = '🎟️';
  wireFields($('#create'));
  wirePlan(() => {});

  const form = () => ({
    date: $('#r-date').value,
    allDay: $('#r-allday').checked,
    from: minutes($('#r-from').value),
    to: minutes($('#r-to').value),
  });
  const times = () => eventTimes(form(), $('#tz').value);
  $('#r-allday').addEventListener('change', () => {
    $('#r-times').hidden = $('#r-allday').checked;
    update();
  });
  $('#create').addEventListener('input', update);
  $('#create').addEventListener('change', update);

  function update() {
    draftChanged();
    const t = times();
    const cap = $('#r-cap-on').checked ? Number($('#r-cap').value) : null;
    setReady(
      'A date that’s set',
      [!$('#title').value.trim(), 'Add a name for your poll', '#title', null, 'its name'],
      [!t, 'Pick the date and start time', $('#r-date').value ? '#r-from' : '#r-date', null, 'the date'],
      [
        cap != null && !(Number.isInteger(cap) && cap >= 1 && cap <= 1000),
        'Spots must be from 1 to 1000',
        '#r-cap',
        null,
        'spots',
      ],
      ...nameAndEmail(),
    );
  }

  $('#create').onsubmit = (e) => {
    e.preventDefault();
    if (explainNotReady()) return;
    submit({ mode: 'rsvp', ...times(), rsvp: values($('#create')) }, () => null);
  };

  /** Start from an existing RSVP: its date and time, and its guest list's settings. */
  async function prefill() {
    const ev = await loadSource(src);
    if (!ev?.rsvp || !$('#create')) return;
    fillCommon(ev, src);
    const o = ev.options?.[0];
    if (o) {
      const tz = ev.timezone || localTz;
      const span = allDaySpan(o.start, o.end, tz);
      const a = utcToZoned(o.start, tz);
      $('#r-date').value = a.date;
      $('#r-allday').checked = !!span;
      $('#r-times').hidden = !!span;
      if (!span) {
        $('#r-from').value = hhmm(a.minutes);
        $('#r-to').value = hhmm(utcToZoned(o.end, tz).minutes);
      }
      if (src.edit) $('#tz').value = tz;
    }
    $('.rsvp-settings').innerHTML = fields(ev.rsvp);
    wireFields($('#create'));
    update();
  }

  showConfig(update);
  if (src) prefill();
  else {
    prefillTitle();
    keepDraft(
      'rsvp',
      () => ({ ...form(), rsvp: values($('#create')) }),
      (d) => {
        if (d.date) $('#r-date').value = d.date;
        $('#r-allday').checked = !!d.allDay;
        $('#r-times').hidden = !!d.allDay;
        if (d.from != null) $('#r-from').value = hhmm(d.from);
        if (d.to != null) $('#r-to').value = hhmm(d.to);
        if (d.rsvp) {
          $('.rsvp-settings').innerHTML = fields(d.rsvp);
          wireFields($('#create'));
        }
        update();
      },
    );
  }
  update();
  $('#title').focus();
  return () => {};
}
