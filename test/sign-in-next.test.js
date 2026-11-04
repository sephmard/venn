// Where signing in comes back to: the page's rule (public/sign-in-next.js) and the server's
// (src/auth.js) agree, so a template link survives signing in by email as it does by Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext as server } from '../src/auth.js';
import { safeNext as page, signInHref } from '../public/sign-in-next.js';

const CASES = [
  ['/new?brand=abc123', '/new?brand=abc123'],
  ['/new/topic?brand=abc123', '/new/topic?brand=abc123'],
  ['/brand/new?look=retro', '/brand/new?look=retro'],
  ['/brand/new?ai=1', '/brand/new?ai=1'],
  ['/new?brand=abc&from=email', '/new?brand=abc&from=email'],
  ['/brand/abc123#join=s3cret', '/me'], // an invite's secret waits with the server, never in a URL
  ['/me', '/me'],
  ['/brand/abc', '/brand/abc'],
  ['/e/abc123#admin=tok', '/me'],
  ['/e/abc123#edit=1.tok', '/me'],
  ['/new?brand=abc&brand=def', '/me'],
  ['/new?title=Hi', '/me'],
  ['/new?brand=../x', '/me'],
  ['/me?next=/x', '/me'],
  ['//evil.example/x', '/me'],
  ['/\\evil.example', '/me'],
  ['https://evil.example/', '/me'],
  ['/new?brand=a b', '/me'],
  ['/new?', '/me'],
  [`/new?brand=${'a'.repeat(200)}`, '/me'],
  ['', '/me'],
  [null, '/me'],
];

test('the page and the server agree on every return path', () => {
  for (const [next, want] of CASES) {
    assert.equal(server(next), want, `server: ${next}`);
    assert.equal(page(next), want, `page: ${next}`);
  }
});

test('Sign in carries the page along only from a template’s link', () => {
  assert.equal(signInHref('/new?brand=abc123'), '/me?next=%2Fnew%3Fbrand%3Dabc123');
  assert.equal(signInHref('/new/topic?brand=none'), '/me?next=%2Fnew%2Ftopic%3Fbrand%3Dnone'); // no template, this once
  assert.equal(signInHref('/new'), '/me'); // a plain form: My polls, as before
  assert.equal(signInHref('/brand/new?look=classic'), '/me?next=%2Fbrand%2Fnew%3Flook%3Dclassic');
  assert.equal(signInHref('/'), '/me');
  assert.equal(signInHref('/templates/book-club'), '/me');
  assert.equal(signInHref('/me'), '/me');
});
