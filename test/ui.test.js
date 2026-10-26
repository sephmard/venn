import { test } from 'node:test';
import assert from 'node:assert/strict';

// ui.js looks up the page's elements when it loads; a stand-in document is enough for these helpers.
const toastEl = { hidden: true, textContent: '' };
globalThis.document = { getElementById: (id) => (id === 'toast' ? toastEl : null) };
const { api, toast } = await import('../public/ui.js');

const respond = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

async function failure(fetchImpl) {
  const real = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await api('events/abc');
  } catch (e) {
    return e;
  } finally {
    globalThis.fetch = real;
  }
  assert.fail('expected the request to fail');
}

test("api: a network failure says Venn can't be reached, not that the poll is missing", async () => {
  const e = await failure(async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(e.message, "Can't reach Venn. Check your connection and try again.");
  assert.equal(e.status, 0);
  assert.equal(e.cause.message, 'Failed to fetch');
});

test('api: errors keep their status, so a 404 can be told apart from the rest', async () => {
  const notFound = await failure(respond(404, { error: 'Poll not found' }));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.message, 'Poll not found');
  assert.equal((await failure(respond(400, ''))).message, 'Request failed (400)');
});

test('api: server errors read as our problem, but a 503 keeps its reason', async () => {
  for (const [status, body] of [
    [500, { error: 'Something went wrong' }],
    [502, '<html>Bad gateway</html>'],
  ]) {
    const e = await failure(respond(status, body));
    assert.equal(e.message, 'Something went wrong on our side. Try again.');
    assert.equal(e.status, status);
  }
  const busy = await failure(respond(503, { error: 'The AI is busy right now. Try again in a minute.' }));
  assert.equal(busy.message, 'The AI is busy right now. Try again in a minute.');
});

test('api: a successful request returns its JSON', async () => {
  const real = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return new Response('{"ok":true}', { status: 200 });
  };
  try {
    assert.deepEqual(await api('events', { method: 'POST', body: { a: 1 } }), { ok: true });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(seen.url, '/api/events');
  assert.equal(seen.init.headers['content-type'], 'application/json');
  assert.equal(seen.init.body, '{"a":1}');
});

test('toast: the status region is emptied, then filled, so the same message is announced again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  toastEl.hidden = true; // as the router leaves it after opening a page
  toastEl.textContent = 'Link copied';
  toast('Link copied');
  assert.equal(toastEl.hidden, false);
  assert.equal(toastEl.textContent, '');
  t.mock.timers.tick(50);
  assert.equal(toastEl.textContent, 'Link copied');
  t.mock.timers.tick(3200);
  assert.equal(toastEl.textContent, '', 'empty again, which hides it, but it stays on the page');
  assert.equal(toastEl.hidden, false);
});
