// Jev, TypeSafe's decision model, reached through OpenRouter's Decisions API. Jev answers typed
// questions about a text (pick one of a few kinds, yes or no, a score) with a probability for each
// answer, in well under a second, for a few millionths of a dollar. Venn asks it which kind of poll
// a request makes (docs/AI.md, "Jev").
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
export async function askJev(env, { state, questions }, { fetch: doFetch = fetch } = {}) {
  if (!jevEnabled(env)) return null;
  try {
    const res = await doFetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.JEV_API_KEY_OPENROUTER}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.JEV_MODEL || JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
 * The cases a check at `hour` (0–23, UTC) covers: 5 an hour for the first 10 hours of each day, so
 * the whole set is checked once a day, a few requests at a time. Other hours: none.
 */
export function casesForHour(hour, cases = KIND_CASES, perHour = 5) {
  const start = hour * perHour;
  return start < cases.length ? cases.slice(start, start + perHour) : [];
}
