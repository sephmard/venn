// The site's own address, for every link the server writes (emails, an API answer's `url`, MCP,
// calendar files, link previews): PUBLIC_URL when the server sets it, otherwise the address the
// request came to. With PUBLIC_URL set, a page opened on any other address of the same server (a
// workers.dev or preview address) moves to the public one, so links made there are never
// internal. Without it (a local or self-hosted server), nothing changes.

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** PUBLIC_URL's origin when it's a usable address (https, or http on this machine), else null. */
export function publicOrigin(env = {}) {
  if (!env.PUBLIC_URL) return null;
  try {
    const u = new URL(String(env.PUBLIC_URL));
    if (u.username || u.password) return null;
    return u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL.test(u.hostname)) ? u.origin : null;
  } catch {
    return null;
  }
}

/** The origin to put in links: PUBLIC_URL's, or the request's own. */
export const siteOrigin = (env, url) => publicOrigin(env) || new URL(url).origin;

/**
 * For a page (not /api/) opened by GET or HEAD on another address than PUBLIC_URL's: a redirect
 * to the same path and query there. A 307 while PUBLIC_URL settles, since browsers don't keep it.
 * Null when there's nothing to do: no PUBLIC_URL, the right address already, this machine (local
 * development), or anything but a page.
 */
export function canonicalRedirect(request, env) {
  const target = publicOrigin(env);
  if (!target) return null;
  const url = new URL(request.url);
  if (url.origin === target || LOCAL.test(url.hostname)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (url.pathname.startsWith('/api/')) return null;
  return new Response(null, {
    status: 307,
    headers: { location: `${target}${url.pathname}${url.search}`, 'cache-control': 'no-store' },
  });
}
