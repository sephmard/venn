// A poll's results, counted on the server: the same counting and ranking the poll page uses, shared
// by the API (`GET /api/events/:id?results=1`) and the MCP server's get_venn_results (src/mcp.js), so
// an app, an assistant and the page can't disagree about what's ahead.

import { IF_NEEDED, YES, isDaysPoll, isOptionsPoll, isTopicPoll, rankTimes } from '../public/core.js';

/**
 * A date poll's days or times, ranked as the poll page ranks them (rankTimes in public/core.js:
 * most people who can make it, then most yeses, then the earliest; a trip's or meeting's length
 * counts every day or hour of it). Times nobody can make are left out. `top` is the best, with
 * every one tied with it only where each stands alone (proposed times and single days, as on the
 * page): hours and runs of days overlap one another, so there `top` is the first alone.
 */
export function rankDates(ev, slots, people) {
  const ranked = rankTimes(ev, slots, people, Infinity);
  const [first] = ranked;
  const same = (r) => r.yes.length === first.yes.length && r.ifNeeded.length === first.ifNeeded.length;
  const alone = isOptionsPoll(ev) || (isDaysPoll(ev) && ev.durationMinutes <= ev.slotMinutes);
  const top = !first ? [] : alone ? ranked.filter(same) : [first];
  return { ranked, top, alone, same };
}

/**
 * A vote's options (a topic poll), ranked as on its page (public/topic-poll.js): yes and if needed
 * both count, more yeses break a tie, then the organizer's order. `top` is every option tied for
 * the lead, and empty while no option has a yes or if needed.
 */
export function rankVote(ev, people) {
  const counts = ev.options.map((o, i) => ({
    ...o,
    i,
    yes: people.filter((p) => p.availability?.[o.id] === YES),
    ifNeeded: people.filter((p) => p.availability?.[o.id] === IF_NEEDED),
  }));
  const score = (o) => o.yes.length + o.ifNeeded.length;
  const ranked = [...counts].sort((a, b) => score(b) - score(a) || b.yes.length - a.yes.length || a.i - b.i);
  const [first] = ranked;
  const top = first && score(first) ? ranked.filter((o) => score(o) === score(first) && o.yes.length === first.yes.length) : [];
  return { counts, ranked, top };
}

/**
 * The results the API returns, from everyone's answers: no names, only counts.
 * A vote: `{ respondents, options: [{ id, yes, ifNeeded }], leaders: [id…] }`.
 * A date poll: `{ respondents, slots: [{ start, yes, ifNeeded }], best: [{ start, end, yes, ifNeeded }]
 * (the 5 best stretches), leaders: [{ start, end }…] }`. `leaders` is empty until something has a yes
 * or if needed; more than one is a tie.
 */
export function pollResults(ev, slots, people) {
  const respondents = people.length;
  if (isTopicPoll(ev)) {
    const { counts, top } = rankVote(ev, people);
    return {
      respondents,
      options: counts.map((o) => ({ id: o.id, yes: o.yes.length, ifNeeded: o.ifNeeded.length })),
      leaders: top.map((o) => o.id),
    };
  }
  // One pass over everyone's answers, not one per slot: a big poll has thousands of slots.
  const tally = new Map(slots.map((s) => [String(s), { start: s, yes: 0, ifNeeded: 0 }]));
  for (const p of people)
    for (const [k, v] of Object.entries(p.availability || {})) {
      const row = tally.get(k);
      if (row && v === YES) row.yes++;
      else if (row && v === IF_NEEDED) row.ifNeeded++;
    }
  const { ranked, top } = rankDates(ev, slots, people);
  return {
    respondents,
    slots: [...tally.values()],
    best: ranked.slice(0, 5).map((r) => ({ start: r.start, end: r.end, yes: r.yes.length, ifNeeded: r.ifNeeded.length })),
    leaders: top.map((r) => ({ start: r.start, end: r.end })),
  };
}
