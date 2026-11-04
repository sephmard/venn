// Where signing in may come back to: the same rule as the server's (src/auth.js safeNext,
// decisions.md G4; test/sign-in-next.test.js checks they agree). A path on this site; on the pages
// that make a poll or a template, only the query keys that pick one; the only fragment a template
// invite's #join=. Anything else is /me.
const NEXT_PATH = /^\/(?!\/)[\w\-/.]*$/;
const NEXT_QUERY_PATH = /^\/(new|new\/topic|brand\/new|brand\/[A-Za-z0-9]{1,32})$/;
const NEXT_QUERY = { brand: /^[A-Za-z0-9]{1,32}$/, look: /^(retro|classic)$/, ai: /^1$/, from: /^[\w-]{1,40}$/ };
export function safeNext(next) {
  if (typeof next !== 'string' || next.length >= 200 || !next.startsWith('/') || /[\\\s]/.test(next)) return '/me';
  const [rest, hash = null] = next.split(/#(.*)/s);
  if (hash !== null && !/^join=[A-Za-z0-9]{1,64}$/.test(hash)) return '/me';
  const [path, query = null] = rest.split(/\?(.*)/s);
  if (!NEXT_PATH.test(path)) return '/me';
  if (query !== null) {
    if (!NEXT_QUERY_PATH.test(path) || !query) return '/me';
    const seen = new Set();
    for (const pair of query.split('&')) {
      const [k, v, extra] = pair.split('=');
      if (extra !== undefined || !Object.hasOwn(NEXT_QUERY, k) || seen.has(k) || !NEXT_QUERY[k].test(v ?? '')) return '/me';
      seen.add(k);
    }
  }
  return next;
}
/** "Sign in" from `here` (a path and query): from a template's link (?brand=, ?look=), back to it after. */
export function signInHref(here) {
  const next = /^\/(new|brand)\b[^?#]*\?/.test(here) ? safeNext(here) : '/me';
  return next === '/me' ? '/me' : `/me?next=${encodeURIComponent(next)}`;
}
