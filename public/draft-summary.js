// What "Use AI" filled in on Create a Venn, in words to check at a glance: the dates and the time
// windows, not just "4 days". "Evenings: Wed, Nov 4 · Thu, Nov 5 · Sat, Nov 7 · Sun, Nov 8".

import { DAY_PARTS, addDays } from './core.js';
import { dateParts, dayLabel, fmtDay, plural, shortRange } from './ui.js';

const PLURAL = { morning: 'Mornings', afternoon: 'Afternoons', evening: 'Evenings' };

/** "Evenings", "Mornings and evenings", "Any time", "2 – 4 PM, 6 – 9 PM", or "All day". */
function windowName(level, items) {
  if (level === 'days') return 'All day';
  if (level === 'parts') {
    const keys = DAY_PARTS.map((p) => p.key).filter((k) => items.some((i) => i.part === k));
    if (keys.length === DAY_PARTS.length) return 'Any time';
    const words = keys.map((k, i) => (i ? PLURAL[k].toLowerCase() : PLURAL[k]));
    return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
  }
  return items.map((i) => shortRange(i.start, i.end)).join(', ');
}

/** Dates as a list, with three or more days running on as one range, and the if needed ones said. */
function dateList(dates, maybe) {
  const runs = [];
  for (const d of dates) {
    const run = runs.at(-1);
    if (run && addDays(run.at(-1), 1) === d && maybe.has(d) === maybe.has(run[0])) run.push(d);
    else runs.push([d]);
  }
  const parts = runs.flatMap((run) => {
    const tag = maybe.has(run[0]) ? ' (if needed)' : '';
    if (run.length < 3) return run.map((d) => dayLabel(d) + tag);
    return [`${fmtDay.formatRange(dateParts(run[0]), dateParts(run.at(-1)))}${tag}`];
  });
  return parts.join(' · ');
}

/**
 * The draft as words: { head, when, note }. `head` is the name, emoji and place; `when` the dates
 * grouped by their time windows; `note` what the AI assumed or left out.
 */
export function describeDraft(draft, title = '') {
  const byDate = new Map();
  for (const d of draft.days) byDate.set(d.date, [...(byDate.get(d.date) || []), d]);
  // Days with the same windows go together, in date order.
  const groups = new Map();
  for (const [date, items] of byDate) {
    const name = windowName(draft.level, items);
    groups.set(name, [...(groups.get(name) || []), date]);
  }
  const maybe = new Set([...byDate].filter(([, items]) => items.every((i) => i.ifNeeded)).map(([d]) => d));
  let when = [...groups].map(([name, dates]) => `${name}: ${dateList(dates, maybe)}`).join('; ');
  if (draft.level === 'days' && draft.row > 1)
    when = `${draft.row} days in a row, from ${plural(byDate.size, 'day')}: ${dateList([...byDate.keys()], maybe)}`;
  return {
    head: [[title, draft.emoji].filter(Boolean).join(' '), draft.location].filter(Boolean).join(' · '),
    when,
    note: draft.note || '',
  };
}
