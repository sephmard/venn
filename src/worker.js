// Cloudflare Worker entry: /api/* goes to the API. Static files in public/ are served
// before the Worker runs; it only sees paths with no matching file.

import { handleApi } from './api.js';
import { createStore, d1Adapter } from './store.js';
import { isAppRoute } from './routes.js';
import { SECURITY_HEADERS } from './security-headers.js';
import { homePage, pollShell } from './preview.js';
import { sendDeadlines } from './deadline.js';

let store;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    store ??= createStore(d1Adapter(env.DB));
    if (url.pathname.startsWith('/api/')) {
      // waitUntil lets notifications finish after the response has been sent.
      return handleApi(request, store, {
        env,
        waitUntil: (p) => ctx.waitUntil(p),
        clientIp: request.headers.get('cf-connecting-ip') || '',
      });
    }
    try {
      return await servePage(request, env, url);
    } catch (e) {
      // Something went wrong making the page (the assets or the database, briefly): Venn's own page
      // without its extras rather than Cloudflare's error page.
      console.error('page failed', url.pathname, e);
      return fallbackPage(request, env, url);
    }
  },

  // Every hour (wrangler.toml): reminders before a poll's deadline, and "answers are in" after it.
  async scheduled(event, env, ctx) {
    store ??= createStore(d1Adapter(env.DB));
    ctx.waitUntil(sendDeadlines({ store, env, now: event.scheduledTime || Date.now() }));
  },
};

/** The pages the Worker makes: /classic, the app's routes (with their link previews), and 404. */
async function servePage(request, env, url) {
  if (url.pathname === '/classic') {
    // The home page in the classic look, with the classic preview (src/preview.js). A plain GET,
    // so it never comes back as a bodiless 304.
    const asset = await env.ASSETS.fetch(new Request(new URL('/', url)));
    const headers = new Headers(asset.headers);
    for (const k of ['content-length', 'content-encoding', 'etag', 'last-modified']) headers.delete(k);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    const html = homePage(await asset.text(), url);
    return new Response(request.method === 'HEAD' ? null : html, { status: asset.status, headers });
  }
  const app = isAppRoute(url.pathname);
  if (app) {
    // Static assets serve app.html at /app. A plain GET, so it never comes back as a bodiless 304:
    // poll pages carry the poll's own link preview (src/preview.js), so the page isn't app.html as it is.
    const asset = await env.ASSETS.fetch(new Request(new URL('/app', url)));
    // An embed page (src/embed.js) may be framed by its template's websites, so it brings its own headers.
    const shell = await pollShell(await asset.text(), { pathname: url.pathname, origin: url.origin, store });
    const html = shell.html;
    const headers = new Headers(asset.headers);
    for (const k of ['content-length', 'content-encoding', 'etag', 'last-modified', 'x-frame-options']) headers.delete(k);
    headers.set('content-type', 'text/html; charset=utf-8');
    for (const [k, v] of Object.entries(shell.headers)) headers.set(k, v);
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
  }
  // ...and 404.html at /404.
  const asset = await env.ASSETS.fetch(new Request(new URL('/404', url), request));
  const res = new Response(asset.body, { status: 404, headers: asset.headers });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

const UNAVAILABLE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Venn</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px"><h1>Venn is having a moment</h1><p>Something went wrong on our side. Try again in a minute.</p></body></html>`;

/**
 * When making a page failed: the plain app (it loads the poll itself, just without the link
 * preview) or home page, and if even that can't be had, a short page saying to try again.
 */
async function fallbackPage(request, env, url) {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  const app = isAppRoute(url.pathname);
  if (app || url.pathname === '/classic') {
    try {
      const asset = await env.ASSETS.fetch(new Request(new URL(app ? '/app' : '/', url)));
      if (asset.ok) return new Response(request.method === 'HEAD' ? null : asset.body, { status: 200, headers });
    } catch (e) {
      console.error('fallback page failed', e?.message);
    }
  }
  return new Response(request.method === 'HEAD' ? null : UNAVAILABLE, { status: 503, headers });
}
