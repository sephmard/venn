import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PAGES, PAGE_SLUGS } from '../pages/pages.js';
import { build, ogImage } from '../scripts/build-pages.js';
import { TEMPLATES, templateIndex } from '../public/templates.js';
import { cleanUsage } from '../src/usage.js';

const file = (path) => new URL(`../${path}`, import.meta.url);

test('pages: public/ has exactly what pages/pages.js makes (run `npm run pages` after editing it)', async () => {
  for (const [path, text] of Object.entries(await build()))
    assert.equal(readFileSync(file(path), 'utf8'), text, `${path} is out of date: run npm run pages`);
});

test('pages: each has its own address, title and description, of a length search results show', () => {
  assert.equal(new Set(PAGE_SLUGS).size, PAGES.length);
  assert.equal(new Set(PAGES.map((p) => p.title)).size, PAGES.length);
  assert.equal(new Set(PAGES.map((p) => p.description)).size, PAGES.length);
  for (const p of PAGES) {
    assert.match(p.slug, /^[a-z0-9-]+$/, p.slug);
    assert.ok(p.title.length <= 75, `${p.slug}: title is ${p.title.length} characters`);
    assert.ok(p.description.length >= 70 && p.description.length <= 160, `${p.slug}: description is ${p.description.length}`);
    assert.ok(p.faq.length >= 3, `${p.slug}: a few questions`);
    for (const s of p.related) assert.ok(PAGE_SLUGS.includes(s), `${p.slug}: related page ${s} doesn't exist`);
    assert.ok(existsSync(file(`public${ogImage(p)}`)), `${p.slug}: no link-preview picture (npm run og)`);
  }
});

test('pages: buttons open a template that exists, on the kind of poll it belongs to', () => {
  for (const p of PAGES.filter((x) => x.template)) {
    const t = TEMPLATES[templateIndex(p.template)];
    assert.ok(t, `${p.slug}: no template ${p.template}`);
    // Several days in a row are found by "ask when people are available".
    if (t.days) assert.equal(p.kind, 'free', p.slug);
  }
});

test('pages: the structured data search engines read is valid JSON, and the sitemap lists every page', async () => {
  const files = await build();
  for (const p of PAGES) {
    const html = files[`public${p.path}.html`];
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.ok(
      blocks.some((b) => b['@type'] === 'FAQPage' && b.mainEntity.length === p.faq.length),
      p.slug,
    );
    assert.ok(
      blocks.some((b) => b['@type'] === 'BreadcrumbList'),
      p.slug,
    );
    assert.match(html, new RegExp(`<link rel="canonical" href="https://venn.day${p.path}" />`));
    assert.match(files['public/sitemap.xml'], new RegExp(`<loc>https://venn.day${p.path}</loc>`));
  }
});

test('pages: usage stats keep where people came from when it is known, and drop the rest', () => {
  assert.equal(
    cleanUsage('view', { page: 'pick', from: 'book-club' }, { client: true }).props,
    '{"from":"book-club","page":"pick"}',
  );
  assert.equal(cleanUsage('view', { page: 'pick', from: 'guest' }, { client: true }).props, '{"from":"guest","page":"pick"}');
  // An unknown one doesn't lose the visit, only where it came from.
  assert.equal(cleanUsage('view', { page: 'pick', from: 'spam-site' }, { client: true }).props, '{"page":"pick"}');
});
