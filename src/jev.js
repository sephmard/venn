// Jev, TypeSafe's decision model, reached through OpenRouter's Decisions API. Jev answers typed
// questions about a text (pick one of a few kinds, yes or no, a score) with a probability for each
// answer, in well under a second, for a few millionths of a dollar. Venn asks it which kind of poll
// a Use AI request makes, and Claude writes what goes in it (docs/AI.md, "Jev").
//
// Optional like the rest of AI: off until the server has JEV_API_KEY_OPENROUTER. The key is sent
// only in the authorization header, never in a URL, and never logged. A failure is never the
// person's problem: every call here answers null when Jev can't, and the caller goes on without it.

import { KIND_CASES } from './kind-cases.js';

export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
/** Pinned, so a new Jev release changes nothing until it's checked (JEV_MODEL picks another). */
export const JEV_MODEL = 'typesafe/jev-1.14';
const TIMEOUT_MS = 4000;
/** A pick this sure or surer is "sure" (the checks count both, so the line can be moved later). */
export const SURE = 0.8;

export const jevEnabled = (env) => Boolean(env?.JEV_API_KEY_OPENROUTER);

/**
 * One Decisions request: { answers, cost } with `cost` in millionths of a dollar, or null when Jev
 * is off or didn't answer. Logs only the status, never the key or the text.
 */
export async function askJev(env, { state, questions }, { fetch: doFetch = fetch, timeout = TIMEOUT_MS } = {}) {
  if (!jevEnabled(env)) return null;
  try {
    const res = await doFetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.JEV_API_KEY_OPENROUTER}`, 'content-type': 'application/json' },
      // Only providers that don't collect or train on the text (OpenRouter's provider routing).
      body: JSON.stringify({ model: env.JEV_MODEL || JEV_MODEL, state, questions, provider: { data_collection: 'deny' } }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      console.error('Jev request failed', { status: res.status });
      return null;
    }
    const out = await res.json();
    if (!out?.answers || typeof out.answers !== 'object') return null;
    const usd = Number(out.usage?.cost);
    return { answers: out.answers, cost: Number.isFinite(usd) && usd > 0 ? Math.ceil(usd * 1e6) : 0 };
  } catch (e) {
    console.error('Jev request failed', { reason: e?.name === 'TimeoutError' ? 'timeout' : 'connection' });
    return null;
  }
}

/** What Jev is asked about a Use AI request: which kind of poll it makes. */
export const KIND_QUESTION = {
  type: 'choice',
  instructions:
    'Someone typed this into a group poll app to set up a poll for their friends, family or team. Which kind of poll does it ask for?',
  criteria: {
    date: 'Finding a day or time that works for everyone, including picking between named days, dates or times.',
    vote: 'Choosing between things (places, food, books, films, games, names, themes, designs), named or still to come. Not when.',
    yesno: 'One question the group answers yes or no.',
    none: 'Nothing to set up: no plan, no question, no choices.',
  },
};

/**
 * Which kind of poll Jev reads in a request: { kind: 'date' | 'vote' | 'yesno' | 'none', p, cost },
 * where `p` is how sure it is (0 to 1), or null when Jev can't answer.
 */
export async function jevKind(env, text, opts) {
  const out = await askJev(env, { state: String(text ?? '').slice(0, 600), questions: { kind: KIND_QUESTION } }, opts);
  const a = out?.answers?.kind;
  if (!a || !Object.hasOwn(KIND_QUESTION.criteria, a.choice)) return null;
  const p = Number(a.probabilities?.[a.choice] ?? a.confidence);
  return { kind: a.choice, p: Number.isFinite(p) ? p : 0, cost: out.cost };
}

/**
 * The cases a check at `hour` (0–23, UTC) covers: 5 an hour for the first 11 hours of each day, so
 * the whole set is checked once a day, a few requests at a time. Other hours: none.
 */
export function casesForHour(hour, cases = KIND_CASES, perHour = 5) {
  const start = hour * perHour;
  return start < cases.length ? cases.slice(start, start + perHour) : [];
}

/** Answer for me waits less for Jev, since Claude starts only after it answers (or doesn't). */
export const ANSWER_TIMEOUT_MS = 2500;

/** The most times one Answer for me request asks Jev about; any after them go to Claude. */
export const MAX_ANSWER_OPTIONS = 40;

const ANSWER_CRITERIA = {
  yes: 'They can make this time: it fits what they wrote, or nothing they wrote rules it out.',
  if_needed: 'They could make it but would rather not, or wrote that it works only if it has to.',
  no: 'What they wrote rules this time out.',
};

/**
 * Answer for me, decided first: how the person would answer each time, from what they wrote.
 * `options` is [{ key, label }] (the time as the person reads it, in their time zone). Only the
 * preferences, the time zone and the times are sent, never the calendar. Returns
 * { answers: { [key]: { answer: 'yes' | 'if_needed' | 'no', p } }, cost } or null.
 */
export async function jevAnswers(env, { preferences, timezone, options }, opts) {
  if (!options.length) return null;
  const questions = Object.fromEntries(
    options.map((o) => [
      o.key,
      {
        type: 'choice',
        instructions: `Someone was asked which times work for them for a group plan, and wrote what's above. The time: ${o.label}. How would they answer for this time?`,
        criteria: ANSWER_CRITERIA,
      },
    ]),
  );
  const state = `What they wrote: ${String(preferences).slice(0, 600)}\nTheir time zone: ${timezone}`;
  const out = await askJev(env, { state, questions }, { timeout: ANSWER_TIMEOUT_MS, ...opts });
  if (!out) return null;
  const answers = {};
  for (const o of options) {
    const a = out.answers[o.key];
    if (!a || !Object.hasOwn(ANSWER_CRITERIA, a.choice)) continue;
    const p = Number(a.probabilities?.[a.choice] ?? a.confidence);
    answers[o.key] = { answer: a.choice, p: Number.isFinite(p) ? p : 0 };
  }
  return { answers, cost: out.cost };
}

// ---------- Does a draft need another pass? (Jev checks Claude's work: measured first, in kind.check) ----------

/** Asked of a Use AI draft: is it ready for the person to check, or does Claude need another pass? */
export const REVIEW_QUESTION = {
  type: 'choice',
  instructions:
    'Someone typed the request above into a group poll app, and an assistant drafted the poll shown under it. Is the draft ready for them to check and send, or does it need another pass?',
  criteria: {
    ready:
      'It is the kind of poll they asked for, and it has what that kind needs: days or times for a date poll; options to pick from for a vote, unless it is one yes-or-no question; and a question that fits the request.',
    fix: 'It is the wrong kind of poll, or it lacks what the request needs: no days, no options to pick from, or a question that does not fit.',
  },
};

/** A draft from draftAny as a few plain lines for Jev to read. */
export function draftSummary(d) {
  if (d.kind === 'date') {
    const days = (d.days || []).slice(0, 8).map((x) => [x.date, x.part || x.from || ''].filter(Boolean).join(' '));
    return [`Kind: date poll`, `Title: ${d.title || ''}`, `Days: ${days.length ? days.join(', ') : 'none'}`].join('\n');
  }
  return [
    `Kind: ${d.yesNo ? 'yes-or-no question' : 'vote'}`,
    `Question: ${d.question || ''}`,
    ...(d.yesNo ? [] : [`Options: ${d.options?.length ? d.options.join(', ') : 'none'}`]),
  ].join('\n');
}

/** Jev's read of a draft: { verdict: 'ready' | 'fix', p, cost }, or null when it can't answer. */
export async function jevReview(env, request, draft, opts) {
  const state = `Request: ${String(request ?? '').slice(0, 600)}\n\nDraft:\n${draftSummary(draft)}`;
  const out = await askJev(env, { state, questions: { review: REVIEW_QUESTION } }, opts);
  const a = out?.answers?.review;
  if (!a || !Object.hasOwn(REVIEW_QUESTION.criteria, a.choice)) return null;
  const p = Number(a.probabilities?.[a.choice] ?? a.confidence);
  return { verdict: a.choice, p: Number.isFinite(p) ? p : 0, cost: out.cost };
}
