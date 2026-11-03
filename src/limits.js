// Per-visitor limits on writes that anyone can make without signing in: new polls and templates,
// and answers. Without them one script could fill the database (SECURITY.md lists "exhaust
// storage with requests" as in scope). Generous enough that no person making polls by hand gets near.

/** How many writes of each kind one IP address may make in ten minutes, unless the server sets its own. */
export const WRITE_LIMITS = {
  create: { env: 'CREATE_RATE_LIMIT', fallback: 30 },
  answer: { env: 'ANSWER_RATE_LIMIT', fallback: 60 },
};

const WINDOW_MS = 10 * 60_000;
const MAX_KEYS = 10_000;

/** Per-server state for the fallback limiter. The Worker shares one per isolate. */
export const writeWindows = () => new Map();

/**
 * Whether this IP may make one more write of `kind` ('create' or 'answer'). Uses Cloudflare's rate
 * limiting binding WRITE_RATE_LIMITER when the server has one (counted across every isolate),
 * otherwise a sliding ten-minute window kept in memory. A limit of 0 turns it off.
 */
export async function allowWrite(env, kind, ip, now, windows) {
  const rule = WRITE_LIMITS[kind];
  const key = `${kind}:${ip || 'unknown'}`;
  if (env.WRITE_RATE_LIMITER) return (await env.WRITE_RATE_LIMITER.limit({ key })).success;
  const set = env[rule.env];
  const n = Math.floor(Number(set));
  const limit = set == null || set === '' || !Number.isFinite(n) ? rule.fallback : Math.max(0, n);
  if (!limit) return true;
  const recent = (windows.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  if (!windows.has(key) && windows.size >= MAX_KEYS) windows.clear();
  windows.set(key, recent);
  return true;
}
