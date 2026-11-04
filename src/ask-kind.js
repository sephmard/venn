// The one "Use AI" box above Date · Vote on /new and /new/topic: which kind of poll a request
// asks for, a date poll or a vote. Pure, so the rule can be tested without a model
// (test/ask-kind.test.js). The policy: docs/AI.md, "Which kind of poll".
//
//   1. Words that say which, in the request itself ("a vote on…", "find a date…"). Checked after
//      the model answers, so they win over it. English only; anything else falls through.
//   2. What's still open, as the days model read it (days-draft.js `decide`): choices to pick
//      between make a vote, a time to find makes a date poll. Choices and a time both: the vote
//      comes first (the time goes in its note, or "Find a date for it" finds it after).
//   3. Neither: nothing to fill in.

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
  String.raw`\b(?:find (?:a |the |us a )?(?:date|time|day)s?\b|when (?:can|could|should|shall|are|is|do)\b|schedul(?:e|ing)\b|(?:what|which) ${TIME_NOUN}\b|availability\b)`,
  'i',
);

/** 'vote', 'date' or null: what the request's own words ask for. The earlier phrase wins. */
export function saidKind(prompt) {
  const text = String(prompt ?? '');
  const vote = text.search(VOTE_WORDS);
  const date = text.search(DATE_WORDS);
  if (vote < 0 && date < 0) return null;
  if (date < 0) return 'vote';
  if (vote < 0) return 'date';
  return date <= vote ? 'date' : 'vote';
}

/**
 * The kind for this request, from its words and the days model's draft ({ days, vote? }, as
 * days-draft.js shapes it): { kind: 'date' | 'vote', why: 'words' | 'open' | 'both' }, or null when
 * there's nothing to fill in. `why` is for usage counts (ai.used): `both` means a time and choices.
 */
export function pickKind(prompt, draft) {
  const days = draft?.days?.length > 0;
  const vote = draft?.vote;
  const said = saidKind(prompt);
  if (said) return { kind: said, why: 'words' };
  // Choices to pick between. A plan that's deciding where *and* when, with nothing named to pick
  // from yet, stays a date poll (its "Vote on it first" link is still there).
  if (vote && (!vote.both || vote.options.length >= 2)) return { kind: 'vote', why: days ? 'both' : 'open' };
  if (days) return { kind: 'date', why: vote ? 'both' : 'open' };
  return null;
}

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
