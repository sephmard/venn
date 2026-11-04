// The hourly check of how well Venn picks the kind of poll (docs/AI.md, "Jev"): a few of the fixed
// cases in src/kind-cases.js go to Jev and to today's picker (the Claude read plus the word rules,
// draftAny in src/ai.js), and each answer is counted as `kind.check` in the usage stats. Only the
// fixed sentences are sent, never anything a person typed. Both are paid by the server's keys and
// count against the weekly dollar cap (AI_WEEKLY_BUDGET_USD); past it, nothing is checked. It runs
// only where Jev is set up (JEV_API_KEY_OPENROUTER), and only with usage stats on, to count into.

import { aiBudget, aiClient, AiUnavailableError, draftAny, meteredClient, weekOf } from './ai.js';
import { casesForHour, jevEnabled, jevKind, SURE } from './jev.js';
import { recordUsage, usageEnabled } from './usage.js';

/** Today's picker's answer as one of the four kinds. */
export async function claudeKind(env, text, { now, anthropic }) {
  try {
    const out = await draftAny(env, { prompt: text, timezone: 'America/New_York' }, { now, anthropic });
    return out.kind === 'vote' && out.yesNo ? 'yesno' : out.kind;
  } catch (e) {
    return e instanceof AiUnavailableError ? 'none' : 'error';
  }
}

/** Run this hour's cases. Returns what was counted, for tests: [{ case, by, got, sure? }]. */
export async function checkKinds({ store, env, now, fetch, anthropic }) {
  const cases = casesForHour(new Date(now).getUTCHours());
  if (!cases.length || !jevEnabled(env) || !usageEnabled(env)) return [];
  const week = weekOf(now);
  const budget = aiBudget(env);
  if (!budget || (await store.aiSpend(week)) >= budget) return [];
  const spend = (micros) => micros > 0 && store.addAiSpend(week, micros);
  const claude =
    env.ANTHROPIC_API_KEY && meteredClient(anthropic ?? aiClient(env), env, (micros) => store.addAiSpend(week, micros));
  const counted = [];
  const count = async (props) => {
    counted.push(props);
    await recordUsage(store, env, now, 'kind.check', props);
  };
  for (const c of cases) {
    const jev = await jevKind(env, c.text, { fetch });
    if (jev) await spend(jev.cost);
    await count({ case: c.id, by: 'jev', got: jev?.kind ?? 'error', sure: jev && jev.p >= SURE ? 'yes' : 'no' });
    if (claude) await count({ case: c.id, by: 'claude', got: await claudeKind(env, c.text, { now, anthropic: claude }) });
  }
  return counted;
}
