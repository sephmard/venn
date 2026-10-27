// Half-day options for "vote on a few dates": a morning, an afternoon or an evening, picked on a
// week of days with the same picker as "parts of the day" on the other create page. Only loaded
// when the organizer picks Half day.

import { DAY_PARTS, IF_NEEDED, YES } from './core.js';
import { paintView } from './paint.js';
import { $$ } from './ui.js';

/**
 * items     the poll's options, Map of "date|<the part's start>" → { date, from, to, v }, changed in place
 * brush()   how new options are marked for the organizer: available or if needed
 * onChange  after each change
 * startAt   the first day to show
 * Returns { render (after items change elsewhere), cleanup }.
 */
export function halfView(root, { items, brush, onChange, startAt }) {
  // The picker holds the same keys as the options.
  const sel = new Set(items.keys());
  // A second tap makes one "if needed", as on the other calendars; the brush paints new ones either way.
  const maybe = new Set([...items].filter(([, it]) => it.v === IF_NEEDED).map(([k]) => k));
  // If-needed options are amber, as on the other calendars, and say so.
  const tint = () => {
    for (const el of $$('.pg-cell', root)) {
      const maybe = items.get(`${el.dataset.d}|${el.dataset.m}`)?.v === IF_NEEDED;
      const label = (el.dataset.label ??= el.getAttribute('aria-label'));
      el.classList.toggle('maybe', maybe);
      el.setAttribute('aria-label', maybe ? `${label}, if needed` : label);
    }
  };
  const painter = paintView(root, {
    selected: sel,
    maybe,
    marking: () => brush() === IF_NEEDED,
    parts: DAY_PARTS,
    startAt,
    onChange() {
      for (const k of [...items.keys()]) if (!sel.has(k)) items.delete(k);
      for (const k of sel) {
        const [date, m] = k.split('|');
        const p = DAY_PARTS.find((x) => x.start === +m);
        const v = maybe.has(k) ? IF_NEEDED : YES;
        if (!items.has(k)) items.set(k, { date, from: p.start, to: p.end, v });
        else items.get(k).v = v;
      }
      tint();
      onChange();
    },
  });
  root.addEventListener('click', tint); // after the picker shows another day or week
  tint();
  return {
    render() {
      sel.clear();
      maybe.clear();
      for (const [k, it] of items) {
        sel.add(k);
        if (it.v === IF_NEEDED) maybe.add(k);
      }
      painter.render();
      tint();
    },
    cleanup() {
      painter.cleanup();
      root.removeEventListener('click', tint);
    },
  };
}
