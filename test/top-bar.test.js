import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// One top bar everywhere: the website's pages, the pages scripts/build-pages.js makes and the app
// (app.html) carry the same menu, so a link added in one place can't be missed in another.
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const links = (html) =>
  [...html.match(/<div class="menu-panel">([\s\S]*?)<\/div>/)[1].matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/g)].map(
    // What a screen reader hears: the text before any tag, then the screen-reader-only words (the ↗ is hidden).
    ([, href, text]) =>
      `${`${text.split('<')[0]} ${text.match(/<span class="sr-only">([^<]*)<\/span>/)?.[1] ?? ''}`.replace(/\s+/g, ' ').trim()} ${href}`,
  );

const WEBSITE = ['public/index.html', 'public/templates.html', 'public/privacy.html', 'public/terms.html', 'public/404.html'];

test('every page with a top bar has the same menu, the app included', () => {
  const want = links(read('public/index.html'));
  assert.deepEqual(want, ['For organizations /brand', 'For developers https://docs.venn.day', 'Contact /#contact']);
  for (const f of [...WEBSITE, 'scripts/build-pages.js', 'public/app.html']) assert.deepEqual(links(read(f)), want, f);
});

test("the app's bar is the website's: the logo, Create a Venn and the menu button", () => {
  const bar = read('public/app.html').match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
  assert.match(bar, /<a href="\/" class="brand">/);
  assert.match(bar, /<a href="\/new" class="btn btn-new" data-link>Create a Venn<\/a>/);
  assert.match(bar, /<summary aria-label="Menu">/);
});

test('Works with Claude is on the home page, under Create a Venn, and not in the menu', () => {
  for (const f of [...WEBSITE, 'scripts/build-pages.js', 'public/app.html'])
    assert.doesNotMatch(read(f).match(/<div class="menu-panel">[\s\S]*?<\/div>/)[0], /claude\.ai/, f);
  // One quiet line under the hero's button, opening Venn's page in Claude in a new tab.
  const hero = read('public/index.html').match(/<section class="hero"[\s\S]*?<\/section>/)[0];
  assert.match(hero, /<p class="claude-note">\s*<a href="https:\/\/claude\.ai\/directory\/venn" target="_blank" rel="noopener"/);
  // The list further down keeps it short: "Works with Claude. Add it", and the link says where it goes.
  const home = read('public/index.html').match(/<ul class="hl-list">[\s\S]*?<\/ul>/)[0];
  assert.match(home, /href="https:\/\/claude\.ai\/directory\/venn" target="_blank" rel="noopener"/);
  assert.match(home, /Works with Claude\.\s*<a[^>]*>Add it/);
  assert.match(home, /opens Venn's page in Claude, in a new tab/);
});
