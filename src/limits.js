// Per-visitor limits on writes that anyone can make without signing in: new polls and templates,
// answers, and usage counts. Without them one script could fill the database (SECURITY.md lists
// "exhaust storage with requests" as in scope). Generous enough that no person gets near by hand.
// Writes through /api/mcp (Venn in Claude and other assistants) come from the assistant's servers
// on behalf of everyone using it, so they share one higher limit of their own.

/** How many writes of each kind one IP address may make in ten minutes, unless the server sets its own. */
export const WRITE_LIMITS = {
  create: { env: 'CREATE_RATE_LIMIT', fallback: 30 },
  // Enough for a 100-person poll shared on one office or school network.
  answer: { env: 'ANSWER_RATE_LIMIT', fallback: 200 },
  mcp: { env: 'MCP_RATE_LIMIT', fallback: 600 },
  // Not a write, but a database read anyone can loop on: GET /api/ai/allowance, asked once per AI panel.
  allowance: { env: 'AI_ALLOWANCE_RATE_LIMIT', fallback: 120 },
  // Anonymous usage counts from the browser (src/usage.js): each one is a database write.
  usage: { env: 'USAGE_RATE_LIMIT', fallback: 300 },
};

const WINDOW_MS = 10 * 60_000;
const MAX_KEYS = 10_000;

/** Per-server state for the fallback limiter. The Worker shares one per isolate. */
export const writeWindows = () => new Map();

/**
 * Whether this IP may make one more write of `kind` ('create', 'answer', 'mcp' or 'usage'), and
 * what to tell the caller: `{ ok, limit, remaining, reset }`, with `reset` the seconds until the
 * oldest write in the window ages out (when refused, the wait until one more is allowed). Uses
 * Cloudflare's rate limiting binding WRITE_RATE_LIMITER when the server has one (counted across
 * every isolate; it says only yes or no), otherwise a sliding ten-minute window kept in memory.
 * A limit of 0 turns it off.
 */
export async function checkWrite(env, kind, ip, now, windows) {
  const rule = WRITE_LIMITS[kind];
  const key = `${kind}:${ip || 'unknown'}`;
  // The binding counts over at most a minute, so a minute is always long enough to wait.
  if (env.WRITE_RATE_LIMITER) {
    const ok = (await env.WRITE_RATE_LIMITER.limit({ key })).success;
    return ok ? { ok } : { ok, reset: 60 };
  }
  const set = env[rule.env];
  const n = Math.floor(Number(set));
  const limit = set == null || set === '' || !Number.isFinite(n) ? rule.fallback : Math.max(0, n);
  if (!limit) return { ok: true };
  const recent = (windows.get(key) || []).filter((t) => now - t < WINDOW_MS);
  const ok = recent.length < limit;
  if (ok) recent.push(now);
  if (!windows.has(key) && windows.size >= MAX_KEYS) windows.clear();
  windows.set(key, recent);
  const reset = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
  return { ok, limit, remaining: limit - recent.length, reset };
}

/** Whether this IP may make one more write of `kind` (see checkWrite). */
export const allowWrite = async (...args) => (await checkWrite(...args)).ok;

/**
 * Headers for a refused write: Retry-After (seconds), and where the count is known, the limit, how
 * many are left (none) and when the window frees up, as RateLimit-Limit, -Remaining and -Reset.
 */
export function limitHeaders({ ok, limit, remaining, reset } = {}) {
  if (ok || reset == null) return {};
  return {
    'retry-after': String(reset),
    ...(limit != null && {
      'ratelimit-limit': String(limit),
      'ratelimit-remaining': String(remaining),
      'ratelimit-reset': String(reset),
    }),
  };
}
