// The hourly check of how well Venn picks the kind of poll (docs/AI.md, "Jev"): a few of the fixed
// cases in src/kind-cases.js go to Jev and to today's picker (the Claude read plus the word rules,
// draftAny in src/ai.js), and each answer is counted as `kind.check` in the usage stats. Only the
// fixed sentences are sent, never anything a person typed. Both are paid by the server's keys and
// count against the weekly dollar cap (AI_WEEKLY_BUDGET_USD); past it, nothing is checked. It runs
// only where Jev is set up (JEV_API_KEY_OPENROUTER), and only with usage stats on, to count into.

import Anthropic from '@anthropic-ai/sdk';
import { aiBudget, AiUnavailableError, draftAny, meteredClient, weekOf } from './ai.js';
import { casesForHour, jevEnabled, jevKind, jevReview, SURE } from './jev.js';
import { recordUsage, usageEnabled } from './usage.js';

/**
 * Today's picker's answer: { got } as one of the four kinds, plus, for a vote that isn't yes or
 * no, { filled } ('yes' when it came with options to pick from, 'no' when it came empty), and
 * the `draft` itself when there was one.
 */
export async function claudeKind(env, text, { now, anthropic }) {
  try {
    const out = await draftAny(env, { prompt: text, timezone: 'America/New_York' }, { now, anthropic, jev: false });
    if (out.kind === 'vote' && out.yesNo) return { got: 'yesno', draft: out };
    return out.kind === 'vote'
      ? { got: 'vote', filled: out.options?.length >= 2 ? 'yes' : 'no', draft: out }
      : { got: out.kind, draft: out };
  } catch (e) {
    return { got: e instanceof AiUnavailableError ? 'none' : 'error' };
  }
}

/** Run this hour's cases. Returns what was counted, for tests: [{ case, by, got, sure?, filled?, review?, reviewSure? }]. */
export async function checkKinds({ store, env, now, fetch, anthropic }) {
  const cases = casesForHour(new Date(now).getUTCHours());
  if (!cases.length || !jevEnabled(env) || !usageEnabled(env)) return [];
  const week = weekOf(now);
  const budget = aiBudget(env);
  if (!budget || (await store.aiSpend(week)) >= budget) return [];
  const spend = (micros) => micros > 0 && store.addAiSpend(week, micros);
  const claude =
    env.ANTHROPIC_API_KEY &&
    // 15 seconds and no retry: a slow hour at Anthropic can't hold the cron or double the calls.
    meteredClient(anthropic ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 15_000 }), env, (micros) =>
      store.addAiSpend(week, micros),
    );
  const counted = [];
  const count = async (props) => {
    counted.push(props);
    await recordUsage(store, env, now, 'kind.check', props);
  };
  for (const c of cases) {
    const jev = await jevKind(env, c.text, { fetch });
    if (jev) await spend(jev.cost);
    await count({ case: c.id, by: 'jev', got: jev?.kind ?? 'error', sure: jev && jev.p >= SURE ? 'yes' : 'no' });
    if (!claude) continue;
    const { draft, ...read } = await claudeKind(env, c.text, { now, anthropic: claude });
    // Would Jev send this draft back to Claude? Counted beside whether it was right, so the two can
    // be compared before Jev's review decides anything in real requests (docs/AI.md, "Jev").
    const review = draft && (await jevReview(env, c.text, draft, { fetch }));
    if (review) await spend(review.cost);
    await count({
      case: c.id,
      by: 'claude',
      ...read,
      ...(draft && { review: review?.verdict ?? 'error', reviewSure: review && review.p >= SURE ? 'yes' : 'no' }),
    });
  }
  return counted;
}
