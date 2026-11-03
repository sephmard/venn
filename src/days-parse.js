// "Use AI" without AI: a few plain words ("Fridays next month", "evenings this week", "a weekend
// trip") turned into the same draft the model's answer becomes (src/days-draft.js), with no model
// at all. Used only where AI can't answer: the server has no AI, or no key and no allowance left
// (src/api.js). It reads only what it is sure of; anything else (clock times, dates by number,
// "except", a vote) gives null, and the page goes on as before. The person reviews the draft, as
// they review AI's.

import { addDays, weekdayOf } from '../public/core.js';
import { shapeDays } from './days-draft.js';

const WEEKDAYS = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};
const MONTHS = 'january february march april may june july august september october november december'.split(' ');
const NUMBERS = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, few: 3 };
const DEFAULT_DAYS = 21; // with no span, the next three weeks, as AI does (DAYS_SYSTEM)
// Words it can't read safely: a limit or a preference it would lose, or a choice to vote on.
const UNSURE =
  /\b(except|not|no|can'?t|cannot|won'?t|busy|ideally|rather|prefer|maybe|backup|optional|needed|unless|vote|choose|decide|between|where|what)\b/;
// A correction ("actually make it Wednesday", "instead of Saturday", "scratch that"): which day
// stands is AI's to read. "Who can make it Friday?" is no correction.
const CORRECTION =
  /\b(actually|instead|scratch that|change it|changed|(?<!\b(?:can|could|will|would|to) )make it (?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)\b/;
// A day with its own time ("Friday evening or Saturday afternoon", "Saturday any time"): the
// reader gives every day the same parts, so two different ones are AI's (or the calendar's) to keep.
const DAY_NAMES = Object.keys(WEEKDAYS).join('|');
const DAY_PART = new RegExp(`\\b(?:${DAY_NAMES})s? (morning|afternoon|evening|night)s?\\b`, 'g');
const ANY_TIME = /\b(any ?time|all day)\b/;
// The plan's name, when it's one of these: what AI would call it.
const TITLES = [
  'date night',
  'game night',
  'movie night',
  'book club',
  'cabin trip',
  'road trip',
  'team lunch',
  'brunch',
  'breakfast',
  'lunch',
  'dinner',
  'drinks',
  'coffee',
  'trip',
  'meeting',
  'party',
];
const PARTS = [
  ['morning', /\bmornings?\b/, /\b(breakfast|brunch)\b/],
  ['afternoon', /\bafternoons?\b/, /\blunch\b/],
  ['evening', /\b(evenings?|tonight)\b/, /\b(dinner|supper|drinks|date night|game night|movie night|party)\b/],
];

const sundayOf = (d) => addDays(d, (7 - weekdayOf(d)) % 7);
const mondayAfter = (d) => addDays(sundayOf(d), 1);
const monthEnd = (y, m) => addDays(`${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}-01`, -1);
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** The words, lower case, with only letters, digits, apostrophes and dashes, padded with spaces. */
const wordsOf = (raw) =>
  ` ${raw
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')} `;
/** Different times for different days, or "any time" beside a part of the day. */
const mixedTimes = (t) =>
  new Set([...t.matchAll(DAY_PART)].map((m) => (m[1] === 'night' ? 'evening' : m[1]))).size > 1 ||
  (ANY_TIME.test(t) && PARTS.some(([, said, implied]) => said.test(t) || implied.test(t)));

/**
 * Why the words gave no draft, when it's one the person can fix by saying it differently:
 * 'correction' ("actually make it Wednesday"), 'parts' (a different time for each day), or null.
 */
export function unsureOf(text) {
  const t = wordsOf(String(text || '').slice(0, 600));
  return CORRECTION.test(t) ? 'correction' : mixedTimes(t) ? 'parts' : null;
}

/**
 * The words read into an answer shaped as the model's (DAYS_SCHEMA), or null when they don't say
 * plainly which days. `today` is YYYY-MM-DD in the person's time zone.
 */
export function parseDays(text, { today }) {
  const raw = String(text || '').slice(0, 600);
  const t = wordsOf(raw);
  if (UNSURE.test(t) || CORRECTION.test(t) || mixedTimes(t)) return null;
  // Numbers only as lengths ("3-day trip", "30-minute call", "next 2 weeks"); a date or a clock time
  // ("Dec 5", "7pm") is for AI or the calendar.
  const lengths = /\b(\d+)[- ]?(days?|nights?|weeks?|minutes?|mins?|hours?|hrs?)\b/g;
  if (/\d/.test(t.replace(lengths, ' '))) return null;
  const notes = [];

  // How many days in a row: "3-day trip", "two nights away", a weekend trip.
  let row = 1;
  const len = /\b(\d+|a|one|two|three|four|five|six)[- ](day|night)s?\b/.exec(t);
  const trip = /\b(trip|getaway|away|stay|holiday|vacation|retreat)\b/.test(t);
  if (len && trip) row = (+len[1] || NUMBERS[len[1]]) + (len[2] === 'night' ? 1 : 0);

  // Which part of the day: said ("evenings"), or what the plan implies ("dinner": evening).
  // What's said beats what the plan implies: "date night, but only afternoons" is afternoons.
  const parts = [];
  const said = PARTS.filter(([key, words]) => words.test(t) && !(key === 'evening' && len?.[2] === 'night'));
  for (const [key, , implied] of PARTS) {
    if (said.some(([k]) => k === key)) parts.push(key);
    else if (!said.length && implied.test(t)) {
      parts.push(key);
      notes.push(`Took ${implied.exec(t)[1]} as ${key}s.`);
    }
  }

  // The span: one of these at most.
  const spans = [];
  const weekend = (from) => {
    const sat = weekdayOf(from) === 0 ? from : addDays(from, (6 - weekdayOf(from) + 7) % 7);
    return [sat, sundayOf(sat)];
  };
  if (/\b(today|tonight)\b/.test(t)) spans.push([today, today]);
  if (/\btomorrow\b/.test(t)) spans.push([addDays(today, 1), addDays(today, 1)]);
  if (/\bthis week\b/.test(t)) spans.push([today, sundayOf(today)]);
  if (/\bnext week\b/.test(t)) spans.push([mondayAfter(today), addDays(mondayAfter(today), 6)]);
  if (/\bnext weekend\b/.test(t)) spans.push(weekend(mondayAfter(today)));
  const weeks = /\b(?:next|coming) (\d+|two|three|four|five|six|couple of|few) weeks\b/.exec(t);
  if (weeks) spans.push([today, addDays(today, 7 * (+weeks[1] || NUMBERS[weeks[1].split(' ')[0]]) - 1)]);
  const [y, m] = today.split('-').map(Number);
  if (/\bthis month\b/.test(t)) spans.push([today, monthEnd(y, m)]);
  if (/\bnext month\b/.test(t)) {
    const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
    spans.push([`${ny}-${String(nm).padStart(2, '0')}-01`, monthEnd(ny, nm)]);
  }
  // A month by name ("in December", "late November"); "may" only as a name ("in May", "May").
  for (const [i, name] of MONTHS.entries()) {
    const at = new RegExp(`\\b(early |mid |late )?${name}\\b`).exec(t);
    if (!at || (name === 'may' && !/\bMay\b/.test(raw) && !/\b(in|during|of) may\b/.test(t))) continue;
    const mm = i + 1;
    const year = mm < m ? y + 1 : y;
    const p = (d) => `${year}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const end = monthEnd(year, mm);
    const [a, b] = { 'early ': [p(1), p(10)], 'mid ': [p(11), p(20)], 'late ': [p(21), end] }[at[1]] || [p(1), end];
    spans.push([a < today ? today : a, b]);
  }
  // "The weekend" (or "this weekend") is a span of its own only when nothing else gives one.
  const theWeekend = /\b(this|the|coming) weekend\b/.test(t) && !/\bnext weekend\b/.test(t);
  if (spans.length > 1) return null; // "next week in December": AI's to sort out
  if (!spans.length && theWeekend) spans.push(weekend(today));

  // Which days of the week: named ones, weekends, weekdays.
  const days = new Set();
  let singular = false; // "Saturday", not "Saturdays"
  let next = ''; // "next Tuesday"
  for (const [, before, name, plural] of t.matchAll(/\b(next |this |every )?([a-z]+?)(s)?\b(?=[ ])/g)) {
    if (!(name in WEEKDAYS) || (name.length < 4 && plural)) continue;
    days.add(WEEKDAYS[name]);
    if (!plural && before !== 'every ') singular = true;
    if (before === 'next ') next = cap(name);
  }
  if (/\bweekends?\b/.test(t)) [6, 0].forEach((d) => days.add(d));
  if (/\bweekdays\b/.test(t)) [1, 2, 3, 4, 5].forEach((d) => days.add(d));
  if (/\bweekend\b/.test(t) && trip && row === 1) row = 2;

  let [first, last] = spans[0] || [];
  if (!first) {
    if (!days.size) return null; // nothing says when
    if (next && singular) {
      // "Next Tuesday": Tuesday next week, said so to check.
      [first, last] = [mondayAfter(today), addDays(mondayAfter(today), 6)];
      notes.push(`Took next ${next} as the one next week.`);
    } else if (singular && !/\bweekends\b/.test(t) && !/\bwhich weekend\b/.test(t))
      [first, last] = [today, addDays(today, 6)]; // "Saturday": the coming one
    else [first, last] = [today, addDays(today, DEFAULT_DAYS - 1)];
  }
  if (first < today) first = today;

  const dates = [];
  for (let d = first; d <= last && dates.length < 31; d = addDays(d, 1)) if (!days.size || days.has(weekdayOf(d))) dates.push(d);
  if (!dates.length) return null;
  if (/\b(minutes?|mins?|hours?|hrs?)\b/.test(t)) notes.push('The meeting’s length isn’t set.');

  const title = TITLES.find((x) => new RegExp(`\\b${x}\\b`).test(t));
  return {
    reading: '',
    title: title ? cap(title) : '',
    emoji: '',
    tile: '',
    location: '',
    timeOfDay: parts.length && row === 1 ? 'parts' : 'any',
    usualParts: row === 1 ? parts : [],
    firstDate: first,
    lastDate: last,
    daysInRow: row,
    days: dates.map((date) => ({ date, parts: [], from: '', to: '', ifNeeded: false })),
    decide: 'when',
    question: '',
    choices: [],
    note: notes.join(' '),
  };
}

/**
 * The draft for the page, as draftDays (src/ai.js) gives it, read from the words alone; null when
 * they don't say plainly which days. Its note says it was read from the words, so it gets checked;
 * on a server with AI (`ai`), that it was read without it.
 */
export function draftFromWords(text, { today, nowMinutes = 0, ai = false }) {
  const out = parseDays(text, { today });
  if (!out) return null;
  const draft = shapeDays(out, { today, nowMinutes });
  if (!draft.days.length) return null;
  return {
    ...draft,
    byWords: true,
    note: [`Read from your words${ai ? ', without AI' : ''}. Check the days.`, draft.note].filter(Boolean).join(' '),
  };
}
