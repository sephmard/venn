// Templates, the kinds of plan: `length` in minutes, 'allday' or 'days'; `part`, when it usually
// is; `season`, month-days when it leads; `quiet`, only when a link (pages/pages.js) picks it.
// Notes: template-notes.js. Emoji must be in src/usage.js PLANS. Positions are ids on the page
// (data-occasion): only add to the end.
export const TEMPLATES = [
  { emoji: '🍝', label: 'Dinner', length: 120, part: 'evening' },
  { emoji: '🍻', label: 'Drinks', length: 120, part: 'evening' },
  { emoji: '☕', label: 'Coffee', length: 60, part: 'morning' },
  { emoji: '📚', label: 'Book club', length: 120, part: 'evening' },
  { emoji: '🥞', label: 'Brunch', length: 120, part: 'morning' },
  { emoji: '🎲', label: 'Game night', length: 180, part: 'evening' },
  { emoji: '🥾', label: 'Hike', length: 'allday', part: 'morning' },
  { emoji: '🎉', label: 'Party', length: 240, part: 'evening' },
  { emoji: '🏋️', label: 'Gym', length: 60, part: 'morning' },
  { emoji: '🏃', label: 'Run', length: 60, part: 'morning' },
  { emoji: '🚴', label: 'Bike', length: 120, part: 'morning' },
  { emoji: '⛳', label: 'Golf', length: 240, part: 'morning' },
  { emoji: '✈️', label: 'Trip', length: 'days', days: 3 },
  { id: 'friendsgiving', emoji: '🦃', label: 'Friendsgiving', length: 240, part: 'evening', season: [1015, 1130] },
  { id: 'holiday-party', emoji: '🎄', label: 'Holiday party', length: 240, part: 'evening', season: [1101, 1223] },
  { id: 'secret-santa', emoji: '🎁', label: 'Secret Santa', length: 180, part: 'evening', season: [1110, 1224] },
  { id: 'new-year', emoji: '🥂', label: 'New Year’s', length: 240, part: 'evening', season: [1210, 110] },
  { id: 'dnd', emoji: '🐉', label: 'D&D session', length: 240, part: 'evening', quiet: true },
  { id: 'band-practice', emoji: '🎸', label: 'Band practice', length: 120, part: 'evening', quiet: true },
  { id: 'study-group', emoji: '✏️', label: 'Study group', length: 120, part: 'afternoon', quiet: true },
  { id: 'family-reunion', emoji: '🏡', label: 'Family reunion', length: 'allday', part: 'morning', quiet: true },
  { id: 'bachelor-party', emoji: '🥳', label: 'Bachelor party', length: 'days', days: 3, quiet: true },
  { id: 'team-offsite', emoji: '🏢', label: 'Team offsite', length: 'days', days: 2, quiet: true },
];

/** Its name in links (?template=book-club). */
export const slug = (t) => t.id || t.label.toLowerCase().replace(/[^a-z]+/g, '-');
/** The template a link names (or its emoji), or -1. */
export const templateIndex = (name) => TEMPLATES.findIndex((t) => slug(t) === String(name).toLowerCase() || t.emoji === name);

const monthDay = (d) => (d.getMonth() + 1) * 100 + d.getDate();
const day = (md) => Math.floor(md / 100) * 31 + (md % 100);
// Roughly how many days from month-day a to b, round the new year if need be.
const until = (a, b) => (day(b) - day(a) + 403) % 403;

/** Whether it's in season on `now` (the browser's own date). Everyday ones always are. */
export function inSeason(t, now = new Date()) {
  if (!t.season) return true;
  const [from, to] = t.season;
  const md = monthDay(now);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/**
 * The cards in order, as [index, hidden]: in season first, the soonest to end leading; then for
 * "ask when people are available" the trip. Out of season and quiet ones stay, hidden, for links and edits.
 */
export function orderTemplates(kind, now = new Date()) {
  const ids = TEMPLATES.map((_, i) => i);
  const on = ids.filter((i) => TEMPLATES[i].season && inSeason(TEMPLATES[i], now));
  on.sort((a, b) => until(monthDay(now), TEMPLATES[a].season[1]) - until(monthDay(now), TEMPLATES[b].season[1]));
  const rank = (i) =>
    on.includes(i) ? 0 : TEMPLATES[i].quiet ? 3 : kind === 'free' && TEMPLATES[i].days ? 1 : TEMPLATES[i].season ? 3 : 2;
  return [...on, ...ids.filter((i) => !on.includes(i)).sort((a, b) => rank(a) - rank(b))].map((i) => [i, rank(i) > 2]);
}
