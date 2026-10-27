// Cloudflare Worker entry: /api/* goes to the API. Static files in public/ are served
// before the Worker runs; it only sees paths with no matching file.

import { handleApi } from './api.js';
import { createStore, d1Adapter } from './store.js';
import { isAppRoute } from './routes.js';
import { SECURITY_HEADERS } from './security-headers.js';
import { appShell } from './preview.js';

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
    const app = isAppRoute(url.pathname);
    if (app) {
      // Static assets serve app.html at /app. A plain GET, so it never comes back as a bodiless 304:
      // poll pages carry the poll's own link preview (src/preview.js), so the page isn't app.html as it is.
      const asset = await env.ASSETS.fetch(new Request(new URL('/app', url)));
      const html = await appShell(await asset.text(), { pathname: url.pathname, origin: url.origin, store });
      const headers = new Headers(asset.headers);
      for (const k of ['content-length', 'content-encoding', 'etag', 'last-modified']) headers.delete(k);
      headers.set('content-type', 'text/html; charset=utf-8');
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
      return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
    }
    // ...and 404.html at /404.
    const asset = await env.ASSETS.fetch(new Request(new URL('/404', url), request));
    const res = new Response(asset.body, { status: 404, headers: asset.headers });
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    return res;
  },
};
