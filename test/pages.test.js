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
  assert.equal(new Set(PAGE_SLUGS).size, PAGE_SLUGS.length);
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

test('pages: buttons open a template that exists', () => {
  for (const p of PAGES.filter((x) => x.template))
    assert.ok(TEMPLATES[templateIndex(p.template)], `${p.slug}: no template ${p.template}`);
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

test('the home page tells search engines and AI assistants what Venn is', () => {
  const html = readFileSync(file('public/index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  for (const type of ['WebSite', 'Organization', 'SoftwareApplication'])
    assert.ok(
      blocks.some((b) => b['@type'] === type),
      type,
    );
});

test('robots.txt keeps polls private and welcomes AI crawlers to the public pages; llms.txt links them', async () => {
  const robots = readFileSync(file('public/robots.txt'), 'utf8');
  for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'])
    assert.match(robots, new RegExp(`User-agent: ${bot}`));
  // Every group keeps polls and the API out, and nothing disallows the whole site.
  const count = (re) => robots.match(re)?.length ?? 0;
  assert.equal(count(/^Disallow: \/e\/$/gm), 2);
  assert.equal(count(/^Disallow: \/api\/$/gm), 2);
  assert.doesNotMatch(robots, /Disallow: \/\s*$/m);
  const llms = (await build())['public/llms.txt'];
  for (const p of PAGES) assert.ok(llms.includes(`https://venn.day${p.path}`), p.path);
});
