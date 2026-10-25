// Cloudflare Worker entry: /api/* goes to the API, everything else to static assets.

import { handleApi } from './api.js';
import { createStore, d1Adapter } from './store.js';

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
    return env.ASSETS.fetch(request);
  },
};
