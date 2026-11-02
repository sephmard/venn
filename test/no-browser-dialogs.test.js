import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// BRAND.md: questions are asked in the page (ask.js), never in a browser alert() or confirm().
// Those look like another product, can't take either look, and some in-app browsers block them.
test('no alert() or confirm() in the browser code', () => {
  const dir = new URL('../public/', import.meta.url);
  const found = [];
  for (const f of readdirSync(dir, { recursive: true })) {
    if (!/\.(js|html)$/.test(f)) continue;
    readFileSync(new URL(f, dir), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/(^|[^\w.$])(window\.)?(alert|confirm)\s*\(/.test(code)) found.push(`public/${f}:${i + 1}`);
      });
  }
  assert.deepEqual(found, [], 'Ask in the page with ask() from public/ask.js instead');
});
