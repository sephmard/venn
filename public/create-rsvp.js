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
import { pickLabel, whenPicker } from './rsvp-when.js';
import { $, app, localTz, todayStr, track } from './ui.js';

/**
 * The event's start and end in UTC milliseconds, from the form's date and times in time zone `tz`:
 * all day runs midnight to midnight; an end at or before the start (or at midnight) is the next day. null if unset.
 */
export function eventTimes({ date, allDay, from, to }, tz) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  if (allDay) return { start: zonedToUtc(date, 0, tz), end: zonedToUtc(addDays(date, 1), 0, tz) };
  if (from == null) return null;
  let until = to ?? from + 120;
  if (until <= from) until += 1440; // an end at or before the start is the next day
  return { start: zonedToUtc(date, from, tz), end: zonedToUtc(addDays(date, Math.floor(until / 1440)), until % 1440, tz) };
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
        <div id="r-when"></div>
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

  let when = null; // set just below; its first pick calls update() before that
  const form = () => when?.get() || {};
  const times = () => eventTimes(form(), $('#tz').value);
  when = whenPicker($('#r-when'), { onChange: () => update() });
  $('#create').addEventListener('input', update);
  $('#create').addEventListener('change', update);

  function update() {
    draftChanged();
    const t = times();
    const cap = $('#r-cap-on').checked ? Number($('#r-cap').value) : null;
    setReady(
      pickLabel(when?.get()),
      [!$('#title').value.trim(), 'Add a name for your poll', '#title', null, 'its name'],
      [!t, 'Pick the date', '#r-when', null, 'the date'],
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
      const a = utcToZoned(o.start, tz);
      if (allDaySpan(o.start, o.end, tz)) when.set({ date: a.date, allDay: true });
      else {
        when.set({ date: a.date, from: a.minutes, to: utcToZoned(o.end, tz).minutes || 1440 });
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
        if (d.date && d.date >= todayStr())
          when.set(d.allDay ? { date: d.date, allDay: true } : { date: d.date, from: d.from, to: d.to });
        if (d.rsvp) {
          $('.rsvp-settings').innerHTML = fields(d.rsvp);
          wireFields($('#create'));
        }
        update();
      },
    );
  }
  update();
  $('#title').focus({ preventScroll: true });
  return () => when.cleanup();
}
