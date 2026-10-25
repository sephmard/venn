// Cloudflare Worker entry: /api/* goes to the API. In production, static files in public/
// are served before the Worker runs, so it only sees paths with no matching file. Staging
// (NOINDEX set) runs the Worker first for every path, so it can mark all of it noindex.

import { handleApi } from './api.js';
import { createStore, d1Adapter } from './store.js';
import { isAppRoute } from './routes.js';
import { SECURITY_HEADERS } from './security-headers.js';

let store;

async function servePage(request, env, url) {
  if (env.NOINDEX) {
    const file = await env.ASSETS.fetch(request);
    if (file.status !== 404) return new Response(file.body, file);
  }
  const app = isAppRoute(url.pathname);
  // Static assets serve app.html at /app and 404.html at /404.
  const asset = await env.ASSETS.fetch(new Request(new URL(app ? '/app' : '/404', url), request));
  return new Response(asset.body, { status: app ? 200 : 404, headers: asset.headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let res;
    if (url.pathname.startsWith('/api/')) {
      store ??= createStore(d1Adapter(env.DB));
      // waitUntil lets notifications finish after the response has been sent.
      res = await handleApi(request, store, {
        env,
        waitUntil: (p) => ctx.waitUntil(p),
        clientIp: request.headers.get('cf-connecting-ip') || '',
      });
    } else {
      res = await servePage(request, env, url);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    }
    // Keep staging and other test copies out of search results.
    if (env.NOINDEX) {
      res = new Response(res.body, res);
      res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
    return res;
  },
};
