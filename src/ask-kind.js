// The one "Use AI" box under Date · Vote on /new and /new/topic: which kind of poll a request
// asks for, a date poll or a vote. Pure, so the rule can be tested without a model
// (test/ask-kind.test.js). The policy: docs/AI.md, "Which kind of poll".
//
//   1. Words that say which, in the request itself ("a vote on…", "find a date…"). Checked after
//      the model answers, so they win over it. English only; anything else falls through.
//   2. What's still open, as the days model read it (days-draft.js `decide`): choices to pick
//      between make a vote, a time to find makes a date poll. Choices and a time both: the vote
//      comes first (the time goes in its note, or "Find a date for it" finds it after).
//   3. Neither: nothing to fill in.
//   An RSVP (the day is set, who's coming?) is said in words ("RSVP", "plus-ones", "10 people
//   max") or read by the model, and needs no more than one day.

import { weekdayOf } from '../public/core.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// "which day", "which evenings": a time to find, not a choice.
const TIME_NOUN = String.raw`(?:days?|dates?|times?|nights?|evenings?|mornings?|afternoons?|weekends?|weeks?|months?|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|january|february|march|april|may|june|july|august|september|october|november|december)`;
// "which of next week", "which of these": not a choice by its own words (the model decides).
const WHICH_NOT = String.raw`(?:${TIME_NOUN}|of (?:next|this|the) (?:week|month|weekend)|of these|of them)`;
const VOTE_WORDS = new RegExp(
  String.raw`\b(?:vote|poll (?:on|about)|(?:choose|pick|decide) between|decide (?:what|where|which)\b(?!\s+${TIME_NOUN}\b)(?!\s+and\s+when\b)|which\b(?!\s+${WHICH_NOT}\b)(?: one)?)`,
  'i',
);
const DATE_WORDS = new RegExp(
  String.raw`\b(?:find (?:a |the |us a )?(?:date|time|day)s?\b|when (?:can|could|should|shall|are|is|do)\b|when['’]s\b|schedul(?:e|ing)\b|(?:what|which) ${TIME_NOUN}\b|availability\b)`,
  'i',
);

// "RSVP", "who's coming", "guest list", "plus-ones", "10 people max": the day is set, who's coming?
const RSVP_WORDS =
  /\b(?:rsvps?\b|who['’]?s (?:coming|in)\b|who (?:is|will be) coming\b|guest ?list\b|plus[- ]ones?\b|\d+\s+spots\b|\d+\s+(?:people|guests)\s+max\b|(?:max(?:imum)?|cap(?:ped)? at|limit(?:ed)? to)\s+(?:of\s+)?\d+\s+(?:people|guests|spots)\b)/i;

/** 'vote', 'date', 'rsvp' or null: what the request's own words ask for. The earlier phrase wins. */
export function saidKind(prompt) {
  const text = String(prompt ?? '');
  const found = [
    ['date', text.search(DATE_WORDS)],
    ['vote', text.search(VOTE_WORDS)],
    ['rsvp', text.search(RSVP_WORDS)],
  ].filter(([, at]) => at >= 0);
  if (!found.length) return null;
  return found.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

/**
 * The kind for this request, from its words, the days model's draft ({ days, vote? }, as
 * days-draft.js shapes it) and its RSVP read (`fixed`, days-draft.js rsvpOf): { kind: 'date' |
 * 'vote' | 'rsvp', why: 'words' | 'open' | 'both' | 'fixed' }, or null when there's nothing to fill
 * in. `why` is for usage counts (ai.used): `both` means a time and choices, `fixed` a day that's set.
 * An RSVP is for one day: words or a read that say RSVP over several days make a date poll.
 */
export function pickKind(prompt, draft, fixed = null) {
  const days = draft?.days?.length > 0;
  const vote = draft?.vote;
  const said = saidKind(prompt);
  if (said === 'rsvp') return !fixed || fixed.dates <= 1 ? { kind: 'rsvp', why: 'words' } : { kind: 'date', why: 'words' };
  if (said) return { kind: said, why: 'words' };
  if (fixed?.said && fixed.dates === 1) return { kind: 'rsvp', why: 'fixed' };
  // Choices to pick between. A plan that's deciding where *and* when, with nothing named to pick
  // from yet, stays a date poll (its "Vote on it first" link is still there).
  if (vote && (!vote.both || vote.options.length >= 2)) return { kind: 'vote', why: days ? 'both' : 'open' };
  if (days) return { kind: 'date', why: vote ? 'both' : 'open' };
  return null;
}

/**
 * Whether the request reads as a question for the group ("Should we get a dog?", "ask my wife if
 * she thinks I'm cute"), so that with no time and nothing named it makes a vote. A plan with no
 * time ("Book club with Sam") doesn't: it still asks for when.
 */
export function readsAsQuestion(prompt) {
  const t = String(prompt || '').trim();
  if (ASKS_WHEN.test(t)) return false;
  return (
    /^(should|shall|is|are|do|does|did|can|could|would|will|who|what|which|where|how|why)\b/i.test(t) ||
    /\bask(ing)?\b.*\b(if|whether|what|which|who|where|how|why)\b/i.test(t)
  );
}
// A question about getting together ("Can we do book club sometime?", "Who can make it?") still
// asks when, so it stays the date poll's. "Free" counts only on its own: "gluten-free" isn't a time.
const ASKS_WHEN =
  /\b(?:when(?:['’]s)?|sometime|soon|(?<![-‐])free(?![-‐])|available|meet(?:ing)? up|get together|catch up|make it|hang out|how about)\b|\bwho (?:can|could) (?:make|come|join)\b/i;

/**
 * The fixed time of a vote whose days come to one date ("pizza or tacos on Friday?"): "Friday,
 * Nov 6", for the vote's note. Several dates, or none: ''.
 */
export function fixedTime(days) {
  const dates = new Set((days || []).map((d) => d.date));
  if (dates.size !== 1) return '';
  const [date] = dates;
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAYS[weekdayOf(date)]}, ${MONTHS[m - 1]} ${d}`;
}

// "Friday evening or Saturday afternoon" names times, not choices.
const TIME_WORDS =
  /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)days?|today|tonight|tomorrow|mornings?|afternoons?|evenings?|nights?|weekends?|weeks?|months?|\d{1,2}(?::\d\d)?\s*(?:am|pm))\b/i;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** A question from the choices alone: "Italian, Thai or Mexican?". */
export const eitherQuestion = (list) =>
  `${list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`}?`.slice(0, 120);

/**
 * With no AI, a choice Venn can still read itself: "Italian, Thai or Mexican?" or "Dinner: Rosa's
 * or Luigi's" → { question, options }, split on commas and "or". Anything less plain (fewer than
 * two short choices, or more than 20): null.
 */
export function choicesOfWords(prompt) {
  const text = String(prompt ?? '')
    .trim()
    .replace(/[?.!]+$/, '');
  if (!/\s+or\s+/i.test(text)) return null;
  const at = text.lastIndexOf(':');
  const ask = at > 0 ? text.slice(0, at).trim() : '';
  const list = (at > 0 ? text.slice(at + 1) : text)
    .replace(/^\s*(?:(?:a )?vote on|choose between|pick between|decide between|either)\s+/i, '')
    .split(/\s*,\s*(?:or\s+)?|\s+or\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const options = [];
  for (const o of list) {
    if (o.length > 60 || o.split(/\s+/).length > 5 || seen.has(o.toLowerCase())) return null;
    seen.add(o.toLowerCase());
    options.push(cap(o));
  }
  if (options.length < 2 || options.length > 20 || options.some((o) => TIME_WORDS.test(o))) return null;
  // "Pizza night, yes or no?": one yes-or-no question.
  if (options.length === 2 && /^yes$/i.test(options[0]) && /^no$/i.test(options[1]))
    return ask ? { question: `${cap(ask)}?`.slice(0, 120), options: [], yesNo: true } : null;
  return { question: ask ? `${cap(ask)}?`.slice(0, 120) : eitherQuestion(options), options };
}

/**
 * The kind Jev picked (src/jev.js jevKind: { kind, p }), when it's sure and the days model's read
 * can fill that kind in: { kind, why, yesNo? }, or null to let pickKind decide. A date poll needs
 * days the read found; "nothing to set up" is never taken from Jev, so Claude's read and the word
 * rules still get their say. `why` keeps the meaning it has in pickKind, for the card's words.
 */
export function jevPick(jev, draft, sure = 0.8, fixed = null) {
  if (!jev || !(jev.p >= sure)) return null;
  // An RSVP is one day: with several, it's a date poll after all, so the other reads decide.
  if (jev.kind === 'rsvp') return !fixed || fixed.dates <= 1 ? { kind: 'rsvp', why: 'fixed' } : null;
  const days = draft?.days?.length > 0;
  const named = draft?.vote?.options?.length >= 2;
  if (jev.kind === 'date') return days ? { kind: 'date', why: 'open' } : null;
  if (jev.kind === 'vote') return { kind: 'vote', why: days ? 'both' : named ? 'open' : 'question' };
  if (jev.kind === 'yesno') return { kind: 'vote', why: 'question', yesNo: true };
  return null;
}
