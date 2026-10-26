// Finn, the Venn dog: what Finn says, and when. Plain logic with no DOM, so it's tested on its own
// (test/finn.test.js); public/finn.js puts it on the page and public/finn-stickers.js draws the stickers.

import { rankTimes } from './core.js';

/**
 * The moments Finn turns up for, most important first, each with a few things to say (one is picked
 * at random) and a pose: how the picture moves, and what's drawn above Finn's head.
 */
export const MOMENTS = {
  match: {
    pose: 'hop',
    extra: ['hat', 'heart'],
    lines: [
      'You said yes to this one. Finn knew you’d be there.',
      'Your date won. Finn saved you a seat.',
      'This is a date you can make. Finn approves.',
    ],
  },
  picked: {
    pose: 'hop',
    extra: ['hat'],
    lines: [
      'It’s set. Finn already has the party hat on.',
      'Date picked. Finn has marked the calendar with a paw.',
      'It’s in the diary. Finn is counting the sleeps.',
    ],
  },
  everyone: {
    pose: 'wag',
    extra: ['sparkle'],
    lines: [
      'Finn found a date that works for everyone.',
      'There’s a date everyone can make. Finn sniffed it out.',
      'Everyone overlaps on a date. Finn is doing a little spin.',
    ],
  },
  first: {
    pose: 'wag',
    extra: ['heart'],
    lines: [
      'The first answer is in. Finn’s tail hasn’t stopped since.',
      'Someone answered. Finn would like everyone to know.',
      'One answer in. Finn says that’s how all good plans start.',
    ],
  },
  waiting: {
    pose: 'tilt',
    extra: ['dots'],
    lines: [
      'Finn is waiting by the door. Share the link and the answers will come.',
      'No answers yet. Finn is keeping an ear out.',
      'All quiet so far. Finn is guarding the poll until your friends turn up.',
    ],
  },
  lost: {
    pose: 'look',
    extra: ['question'],
    lines: [
      'Finn couldn’t sniff out this poll.',
      'Finn looked everywhere, even under the sofa. No poll here.',
      'Finn followed the trail, but there’s no poll at the end of it.',
    ],
  },
};

/** One of the moment's lines, at random (`rng` returns 0 to 1, like Math.random). */
export function pickLine(moment, rng = Math.random) {
  const lines = MOMENTS[moment]?.lines;
  if (!lines) return '';
  return lines[Math.min(lines.length - 1, Math.floor(rng() * lines.length))];
}

/** Did `p` answer yes or if needed for the picked date? */
function canMake(ev, p) {
  if (!p) return false;
  const [hit] = rankTimes(ev, ev.slots || [], [p], Infinity).filter((r) => r.start === ev.finalStart);
  return !!hit && !hit.no.length;
}

/**
 * Which moment a poll is at, for whoever is looking (`meId`: their own answer's id, if they've
 * answered), or null when it's nothing Finn needs to say anything about.
 * - match: the date is picked, and it's one this guest said they could make
 * - picked: the date is picked
 * - everyone: no date yet, but at least three people answered and one works for all of them
 * - first: the organizer's first answer from a guest is in
 * - waiting: the organizer's poll has no answers from guests yet
 */
export function momentFor(ev, { meId = null } = {}) {
  if (!ev) return null;
  const people = ev.participants || [];
  if (ev.finalStart != null) {
    const me = !ev.isAdmin && people.find((p) => p.id === meId);
    return me && canMake(ev, me) ? 'match' : 'picked';
  }
  if (people.length >= 3) {
    const [best] = rankTimes(ev, ev.slots || [], people, 1);
    if (best && best.yes.length + best.ifNeeded.length === people.length) return 'everyone';
  }
  if (!ev.isAdmin) return null;
  const guests = people.filter((p) => p.id !== ev.hostId).length;
  return guests === 0 ? 'waiting' : guests === 1 ? 'first' : null;
}

// ---------- not saying the same thing twice ----------

const key = (id) => `venn:finn:${id}`;

/** The moments Finn has already had on this poll, in this browser. */
export function seenMoments(id, storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(key(id)));
    return Array.isArray(list) ? list : [];
  } catch {
    return []; // private mode, storage off, or something odd stored
  }
}

/** Remember that Finn has had `moment` on this poll, so it isn't shown again. */
export function markSeen(id, moment, storage = globalThis.localStorage) {
  const list = seenMoments(id, storage);
  if (list.includes(moment)) return;
  try {
    storage.setItem(key(id), JSON.stringify([...list, moment]));
  } catch {}
}

/**
 * The moment to show now, or null: the poll's moment, unless Finn has had it here before. Finn
 * doesn't go back to waiting by the door once anyone has answered.
 */
export function nextMoment(id, ev, opts, storage) {
  const m = momentFor(ev, opts);
  if (!m) return null;
  const seen = seenMoments(id, storage);
  if (seen.includes(m)) return null;
  if (m === 'waiting' && seen.some((s) => s !== 'waiting')) return null;
  return m;
}

// ---------- stickers ----------

/** Finn stickers: a caption, and what Finn is wearing or has nearby. */
export const STICKERS = [
  { key: 'its-set', caption: 'It’s set!', extra: ['hat', 'confetti'], tilt: -4 },
  { key: 'see-you-there', caption: 'See you there', extra: ['scarf'], tilt: 3 },
  { key: 'im-in', caption: 'I’m in', extra: ['heart'], tilt: -3 },
  { key: 'finn-approves', caption: 'Finn approves', extra: ['check'], tilt: 2 },
  { key: 'plans-over-excuses', caption: 'Plans > excuses', extra: ['shades'], tilt: -2 },
  { key: 'cant-wait', caption: 'Can’t wait', extra: ['sparkle'], tilt: 4 },
];

/** "finn-its-set.png" */
export const stickerFile = (sticker) => `finn-${sticker.key}.png`;
