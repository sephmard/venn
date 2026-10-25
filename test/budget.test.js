import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Venn has to load fast on phones over slow connections. These budgets fail the build if the
// code the browser downloads grows a lot; raise them deliberately, in review, if a feature needs it.
// The app shell, its stylesheet and every script module it can load.
const FILES = [
  'app.html',
  'styles.css',
  ...readdirSync(new URL('../public/', import.meta.url)).filter((f) => f.endsWith('.js') && !f.startsWith('oauth-')),
];
const PER_FILE_KB = 25;
const TOTAL_KB = 45;

test('page weight stays within budget (gzipped)', () => {
  let total = 0;
  for (const f of FILES) {
    const kb = gzipSync(readFileSync(new URL(`../public/${f}`, import.meta.url))).length / 1024;
    total += kb;
    assert.ok(kb <= PER_FILE_KB, `public/${f} is ${kb.toFixed(1)} KB gzipped (budget ${PER_FILE_KB} KB)`);
  }
  assert.ok(total <= TOTAL_KB, `the app is ${total.toFixed(1)} KB gzipped in total (budget ${TOTAL_KB} KB)`);
});
