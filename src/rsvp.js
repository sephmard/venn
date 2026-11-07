// RSVP polls: the date is set, and guests say Going, Maybe or Can't go. The organizer can cap the
// spots (a waitlist forms once they're taken), let each guest bring plus-ones, and approve each
// RSVP before it counts. Worked out here from the answers, so every page and API client sees the
// same list: who's in, who's waiting and in what order, and how many spots are left.

import { IF_NEEDED, YES } from '../public/core.js';

/** The one answer key of an RSVP: its option's start. */
export const rsvpKey = (ev) => String(ev.options[0].start);

/**
 * Each answer's place on the guest list, and the totals. `participants` are the poll's answers,
 * `rows` the store's RSVP rows (store.listRsvps). Going counts in the order people first said Going;
 * once a party doesn't fit in the spots left, it and everyone after it wait, so nobody skips the
 * line. The organizer's own answer never waits for approval.
 *
 * Returns { of: Map(participant id → { status, guests, place? }), counts }, where status is
 * going | waitlist | requested | declined | maybe | no, and counts are
 * { going (heads, plus-ones included), people, waitlist, requested, maybe, no, spotsLeft (null with no cap) }.
 */
export function rsvpView(ev, participants, rows = new Map()) {
  const key = rsvpKey(ev);
  const { cap = null, plusOnes = 0, approve = false } = ev.rsvp || {};
  const of = new Map();
  const line = [];
  for (const p of participants) {
    const row = rows.get(p.id) || {};
    const v = p.availability[key];
    if (v !== YES) {
      of.set(p.id, { status: v === IF_NEEDED ? 'maybe' : 'no', guests: 0 });
      continue;
    }
    const guests = Math.min(row.guests || 0, plusOnes);
    if (row.approval === 'declined') of.set(p.id, { status: 'declined', guests });
    else if (approve && row.approval !== 'approved' && p.id !== ev.hostId) of.set(p.id, { status: 'requested', guests });
    else line.push({ id: p.id, guests, at: row.goingAt ?? p.updatedAt ?? 0 });
  }
  line.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  let heads = 0;
  let people = 0;
  let waiting = 0;
  for (const g of line) {
    if (!waiting && (cap == null || heads + 1 + g.guests <= cap)) {
      heads += 1 + g.guests;
      people += 1;
      of.set(g.id, { status: 'going', guests: g.guests });
    } else of.set(g.id, { status: 'waitlist', guests: g.guests, place: ++waiting });
  }
  const count = (s) => [...of.values()].filter((x) => x.status === s).length;
  return {
    of,
    counts: {
      going: heads,
      people,
      waitlist: waiting,
      requested: count('requested'),
      maybe: count('maybe'),
      no: count('no'),
      spotsLeft: cap == null ? null : Math.max(0, cap - heads),
    },
  };
}

/** The plus-ones someone asked to bring, as the poll allows: 0 unless they're going. */
export function normalizeGuests(ev, value, going) {
  const max = ev.rsvp?.plusOnes || 0;
  if (!going || value == null) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, max);
}
