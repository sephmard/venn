// Zero-dependency Node server for local use or self-hosting (Node 22.13+).
//   node server.js            -> http://localhost:8787, data in ./data/venn.db
//   PORT=3000 DB_PATH=:memory: node server.js

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { lookup } from 'node:dns/promises';
import { handleApi } from './src/api.js';
import { createStore, sqliteAdapter } from './src/store.js';
import { SECURITY_HEADERS } from './src/security-headers.js';
import { isAppRoute } from './src/routes.js';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// Node can resolve DNS, so webhook hosts are checked against private addresses before use.
const resolveHost = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

export function createApp({ dbPath = ':memory:', env = process.env, fetchImpl = fetch, resolve = resolveHost, anthropic } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const store = createStore(sqliteAdapter(new DatabaseSync(dbPath)));
  const aiWindows = new Map(); // AI rate limiting, per server
  // Background work (notifications) runs after the response is sent; tests can await it.
  const pending = new Set();
  const waitUntil = (promise) => {
    const p = Promise.resolve(promise)
      .catch((e) => console.error(e))
      .finally(() => pending.delete(p));
    pending.add(p);
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const request = new Request(url, { method: req.method, headers: req.headers, body: body?.length ? body : undefined });
        const response = await handleApi(request, store, {
          env,
          waitUntil,
          fetchImpl,
          resolveHost: resolve,
          clientIp: req.socket.remoteAddress || '',
          anthropic,
          aiWindows,
        });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      await serveStatic(url.pathname, res);
    } catch (e) {
      console.error(e);
      res.writeHead(500).end('Internal error');
    }
  });
  server.settled = () => Promise.all([...pending]);
  return server;
}

async function serveStatic(pathname, res) {
  let rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  if (rel.endsWith('/')) rel += 'index';
  // Like Cloudflare: /privacy serves privacy.html. The app's own routes get the app shell.
  const candidates = isAppRoute(pathname) ? ['app.html'] : [rel, `${rel}.html`];
  let status = 200;
  let file, data;
  for (const c of candidates) {
    const f = join(publicDir, c);
    // Stay inside public/, and keep config files like _headers private.
    if (!f.startsWith(publicDir + sep) || basename(f).startsWith('_')) continue;
    try {
      data = await readFile(f);
      file = f;
      break;
    } catch {}
  }
  if (!data) {
    status = 404;
    file = join(publicDir, '404.html');
    data = await readFile(file);
  }
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8787);
  const dbPath = process.env.DB_PATH || join(root, 'data', 'venn.db');
  createApp({ dbPath }).listen(port, () => console.log(`Venn running at http://localhost:${port}`));
}
