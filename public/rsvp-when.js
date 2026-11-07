// "When is it?" on /new/rsvp: the same calendars a date poll is made with (whole days, parts of the
// day, hours), picking the one time the RSVP is for. A new pick replaces the last one. The calendars
// load on demand, as on /new.

import { DAY_PARTS } from './core.js';
import { $$, dayLabel, esc, rove, shortRange, shortTime } from './ui.js';

export const LEVELS = [
  ['days', 'Days'],
  ['parts', 'Parts of day'],
  ['hours', 'Hours'],
];
const EVENING = DAY_PARTS.find((p) => p.key === 'evening');

/** The level a time reads best at: a whole day, one of the parts of the day, or hours. */
export function levelOf(pick) {
  if (!pick?.date) return 'days';
  if (pick.allDay) return 'days';
  return DAY_PARTS.some((p) => p.start === pick.from && p.end === pick.to) ? 'parts' : 'hours';
}

/** A pick moved to another level: a day keeps its date; parts and hours keep its times. */
export function carry(pick, level) {
  if (!pick?.date) return pick;
  const { date } = pick;
  if (level === 'days') return { date, allDay: true };
  if (level === 'parts') {
    const part = (!pick.allDay && DAY_PARTS.find((p) => pick.from >= p.start && pick.from < p.end)) || EVENING;
    return { date, from: part.start, to: part.end };
  }
  return pick.allDay ? { date, from: 1140, to: 1260 } : { date, from: pick.from, to: pick.to };
}

/** "Sat, Jun 7 · Evening, 6 – 10 PM", "Sat, Jun 7 · All day", or "" with nothing picked. */
export function pickLabel(pick) {
  if (!pick?.date) return '';
  if (pick.allDay) return `${dayLabel(pick.date)} · All day`;
  const part = DAY_PARTS.find((p) => p.start === pick.from && p.end === pick.to);
  const time = pick.to > pick.from ? shortRange(pick.from, pick.to) : shortTime(pick.from);
  return `${dayLabel(pick.date)} · ${part ? `${part.label}, ${time}` : time}`;
}

/**
 * The picker in `root`. `get()` and `set(pick)` read and write { date, allDay } or
 * { date, from, to } (minutes); `onChange` runs after every pick.
 */
export function whenPicker(root, { onChange = () => {} } = {}) {
  let pick = null;
  let level = 'days';
  let view = null;
  let mounts = 0;
  root.innerHTML = `
    <div class="zoom">
      <div class="seg" role="radiogroup" aria-label="Pick a">
        ${LEVELS.map(([k, l]) => `<button type="button" role="radio" data-rlevel="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <div id="r-cal"></div>
    <p class="rsvp-pick" id="r-pick" aria-live="polite"></p>`;
  const cal = root.querySelector('#r-cal');

  function changed() {
    const label = pickLabel(pick);
    root.querySelector('#r-pick').innerHTML = label ? `<strong>${esc(label)}</strong>` : 'Tap a day.';
    view?.render();
    onChange(pick);
  }

  async function mount() {
    view?.cleanup();
    view = null;
    const at = ++mounts;
    const first = pick?.date;
    if (level === 'days') {
      const { monthView } = await import('./picker.js');
      if (at !== mounts || !cal.isConnected) return;
      cal.innerHTML = '';
      const selected = new Set(first ? [first] : []);
      const v = monthView(cal, {
        selected,
        drag: false,
        onChange: () => {
          // One day: the newest tap wins, and a tap on the picked day keeps it.
          const added = [...selected].find((d) => d !== pick?.date);
          selected.clear();
          const date = added || pick?.date;
          if (date) selected.add(date);
          pick = date ? { date, allDay: true } : null;
          changed();
        },
      });
      if (first) v.show(first);
      view = { render: v.render, cleanup: v.cleanup };
      return;
    }
    const [{ paintView }, { timeView }, { editBlocks }] = await Promise.all([
      import('./paint.js'),
      import('./time-view.js'),
      import('./block-edit.js'),
    ]);
    if (at !== mounts || !cal.isConnected) return;
    cal.innerHTML = '';
    if (level === 'parts') {
      const keyOf = (p) => (p?.date && !p.allDay ? `${p.date}|${p.from}` : null);
      const selected = new Set([keyOf(pick)].filter(Boolean));
      const v = paintView(cal, {
        selected,
        parts: DAY_PARTS,
        views: ['week'],
        drag: false,
        startAt: first,
        onChange: () => {
          const added = [...selected].find((k) => k !== keyOf(pick));
          selected.clear();
          const k = added || keyOf(pick);
          if (k) selected.add(k);
          const [date, start] = (k || '').split('|');
          const part = DAY_PARTS.find((p) => p.start === +start);
          pick = k && part ? { date, from: part.start, to: part.end } : null;
          changed();
        },
      });
      view = { render: v.render, cleanup: v.cleanup };
      return;
    }
    const v = timeView(cal, {
      label: 'Calendar',
      views: ['week'],
      range: () => [420, 1440],
      tapLength: () => 120, // a tap is a two-hour start; drag to change it
      tapSnap: () => 30,
      startAt: () => (pick && !pick.allDay ? Math.max(420, pick.from - 60) : 1020),
      blocks: () =>
        pick && !pick.allDay
          ? [
              {
                key: 'rsvp',
                date: pick.date,
                from: pick.from,
                to: Math.min(pick.to > pick.from ? pick.to : pick.from + 120, 1440),
                cls: 'opt',
                label: shortRange(pick.from, pick.to),
                short: shortTime(pick.from),
                tiny: shortTime(pick.from),
                tag: 'Picked',
                title: `${shortRange(pick.from, pick.to)}, ${dayLabel(pick.date)}`,
                remove: `Remove ${shortRange(pick.from, pick.to)}, ${dayLabel(pick.date)}`,
              },
            ]
          : [],
      onCreate: (date, from, to) => {
        pick = { date, from, to };
        changed();
      },
      onBlock: () => {},
      onResize: (_, from, to) => {
        pick = { ...pick, from, to };
        changed();
      },
      onMove: (_, date, from, to) => {
        pick = { date, from, to };
        changed();
      },
      editBlocks: (el, o) =>
        editBlocks(el, {
          ...o,
          onRemove: () => {
            pick = null;
            changed();
          },
        }),
      marks: (d) => (pick?.date === d && !pick.allDay ? '1' : ''),
    });
    if (first) v.show(first);
    view = { render: v.render, cleanup: v.cleanup };
  }

  function setLevel(next, { keep = false } = {}) {
    if (!keep) pick = carry(pick, next);
    level = next;
    for (const b of $$('[data-rlevel]', root)) b.setAttribute('aria-checked', b.dataset.rlevel === level);
    rove(root.querySelector('.seg'));
    mount();
    changed();
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rlevel]');
    if (b && b.dataset.rlevel !== level) setLevel(b.dataset.rlevel);
  });
  setLevel('days', { keep: true });

  return {
    get: () => pick,
    set(p) {
      pick = p?.date ? p : null;
      setLevel(levelOf(pick), { keep: true });
    },
    focus: () => root.querySelector('.cal-day:not(:disabled), .pg-cell[tabindex="0"], .tg-scroll, [data-rlevel]')?.focus(),
    cleanup: () => view?.cleanup(),
  };
}
