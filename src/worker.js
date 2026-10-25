// Cloudflare Worker entry: /api/* goes to the API. Static files in public/ are served
// before the Worker runs; it only sees paths with no matching file.

import { handleApi } from './api.js';
import { createStore, d1Adapter } from './store.js';
import { isAppRoute } from './routes.js';
import { SECURITY_HEADERS } from './security-headers.js';

let store;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      store ??= createStore(d1Adapter(env.DB));
      // waitUntil lets notifications finish after the response has been sent.
      return handleApi(request, store, {
        env,
        waitUntil: (p) => ctx.waitUntil(p),
        clientIp: request.headers.get('cf-connecting-ip') || '',
      });
    }
    const app = isAppRoute(url.pathname);
    // Static assets serve app.html at /app and 404.html at /404.
    const asset = await env.ASSETS.fetch(new Request(new URL(app ? '/app' : '/404', url), request));
    const res = new Response(asset.body, { status: app ? 200 : 404, headers: asset.headers });
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  },
};
