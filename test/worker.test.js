import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

// A stand-in for the static assets binding: a few files, 404 for anything else.
const FILES = { '/': 'landing', '/robots.txt': 'robots', '/app': 'app shell', '/404': 'not found page' };
const ASSETS = {
  fetch: async (req) => {
    const body = FILES[new URL(req.url).pathname];
    return body ? new Response(body, { headers: { 'content-type': 'text/html' } }) : new Response('', { status: 404 });
  },
};
const get = (path, env = {}) => worker.fetch(new Request(`https://venn.test${path}`), { ASSETS, ...env }, {});

test('production: app routes get the app shell, other paths the 404 page, nothing is noindex', async () => {
  const app = await get('/e/abc123');
  assert.equal(app.status, 200);
  assert.equal(await app.text(), 'app shell');
  assert.equal(app.headers.get('x-robots-tag'), null);
  assert.ok(app.headers.get('content-security-policy'));

  const missing = await get('/nope');
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'not found page');
});

test('staging (NOINDEX): files, app routes and 404s are all served, and all marked noindex', async () => {
  const env = { NOINDEX: 'true' };
  for (const [path, status, body] of [
    ['/', 200, 'landing'],
    ['/robots.txt', 200, 'robots'],
    ['/new', 200, 'app shell'],
    ['/nope', 404, 'not found page'],
  ]) {
    const res = await get(path, env);
    assert.equal(res.status, status, path);
    assert.equal(await res.text(), body, path);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', path);
    assert.ok(res.headers.get('content-security-policy'), path);
  }
});

test('staging (NOINDEX): API responses are noindex too', async () => {
  const res = await get('/api/config', { NOINDEX: 'true', DB: null });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
});
