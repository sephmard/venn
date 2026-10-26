import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Venn has to load fast on phones over slow connections. These budgets fail the build if what the
// browser downloads for a page grows a lot; raise them deliberately, in review, if a feature needs it.
const PER_FILE_KB = 25;

const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url));
const kb = (f) => gzipSync(read(f)).length / 1024;

/** A module and everything it imports statically (dynamic imports load later, per page). */
function closure(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const [, dep] of read(entry)
    .toString()
    .matchAll(/^import\b[^'"]*['"]\.\/([\w.-]+\.js)['"]/gm))
    closure(dep, seen);
  return seen;
}

// The app shell plus the code each kind of page loads.
const SHELL = ['app.html', 'styles.css', 'app.js'];
// Each page: its code, its own stylesheet, and its budget in KB. Guests open polls on their phones
// from a group chat, so the poll page is the tightest. The create pages carry their own stylesheet
// (create.css), so guests never download it.
const PAGES = {
  'create pages': ['create.js', ['create.css'], 47],
  'poll page': ['event.js', [], 45],
};

for (const [name, [entry, css, PAGE_KB]] of Object.entries(PAGES)) {
  test(`page weight: ${name} stay within budget (gzipped)`, () => {
    const files = [...SHELL, ...css, ...closure(entry)];
    let total = 0;
    for (const f of files) {
      total += kb(f);
      assert.ok(kb(f) <= PER_FILE_KB, `public/${f} is ${kb(f).toFixed(1)} KB gzipped (budget ${PER_FILE_KB} KB)`);
    }
    assert.ok(
      total <= PAGE_KB,
      `the ${name} download ${total.toFixed(1)} KB gzipped (budget ${PAGE_KB} KB): ${files.join(', ')}`,
    );
  });
}

test('page weight: the router loads pages on demand, not up front', () => {
  assert.doesNotMatch(read('app.js').toString(), /^import\b/m);
});
