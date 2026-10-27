import { test } from 'node:test';
import assert from 'node:assert/strict';

// The comparison pages (/compare, /compare/doodle-alternative, /compare/when2meet-alternative):
// static pages built like the template pages, for people searching for an alternative.

const PAGES = ['/compare', '/compare/doodle-alternative', '/compare/when2meet-alternative'];
const TRADEMARK = "Doodle and When2meet are trademarks of their owners; Venn isn't affiliated with them.";
// Visible text, the way a search engine reads it: tags dropped, spaces collapsed.
const text = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function withServer(fn) {
  const { createApp } = await import('../server.js');
  const server = createApp();
  await new Promise((r) => server.listen(0, r));
  try {
    await fn(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('compare pages: served at clean paths, in the sitemap, each with its own title, description and link preview', async () => {
  await withServer(async (base) => {
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    const titles = new Set();
    for (const path of ['/templates', '/templates/friendsgiving', '/']) {
      titles.add((await (await fetch(base + path)).text()).match(/<title>([^<]+)<\/title>/)[1]);
    }
    for (const path of PAGES) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.ok(sitemap.includes(`<loc>https://venn.day${path}</loc>`), `${path} in the sitemap`);
      assert.ok(html.includes(`<link rel="canonical" href="https://venn.day${path}" />`), path);
      assert.ok(html.includes(`<meta property="og:url" content="https://venn.day${path}" />`), path);
      assert.match(html, /<meta property="og:title" content="[^"]{10,}" \/>/, path);
      assert.match(html, /<meta\s+property="og:description"\s+content="[^"]{50,}"/, path);
      assert.ok(html.includes('<meta property="og:image" content="https://venn.day/og.png" />'), path);
      assert.match(html, /<meta\s+name="description"\s+content="[^"]{50,170}"/, path);
      assert.equal(html.match(/<h1[\s>]/g)?.length, 1, path);
      const title = html.match(/<title>([^<]+)<\/title>/)[1];
      assert.ok(!titles.has(title), title);
      titles.add(title);
      // Plain-text names only: no one else's logo, and the trademark line.
      assert.doesNotMatch(html, /<img[^>]+src="[^"]*(doodle|when2meet)/i, path);
      assert.ok(text(html).includes(TRADEMARK), path);
      // Every picture says what it shows, or is marked as decoration.
      for (const [img] of html.matchAll(/<img[^>]*>/g)) assert.match(img, /alt="[^"]*"/, img);
    }
    for (const title of [
      "A Doodle alternative that's free, with no ads · Venn",
      'A When2meet alternative that works on phones · Venn',
      'Venn compared with Doodle and When2meet · Venn',
    ])
      assert.ok(titles.has(title), title);
  });
});

test('compare pages: a breadcrumb, a big button to make a poll, a dated table, a phone screen and the steps to switch', async () => {
  await withServer(async (base) => {
    for (const path of PAGES.slice(1)) {
      const html = await (await fetch(base + path)).text();
      const name = path.endsWith('doodle-alternative') ? 'Doodle' : 'When2meet';
      assert.match(html, /<h1>A (Doodle|When2meet) alternative/, path);
      assert.ok(html.includes(`<span aria-current="page">${name} alternative</span>`), path);
      assert.match(html, /<nav class="crumbs" aria-label="Breadcrumb">\s*<a href="\/compare">Compare<\/a>/, path);
      assert.match(html, /<a class="btn btn-lg" href="\/new">/, path);
      assert.match(html, /<a href="\/new" class="btn btn-lg">/, path);
      // The table names both, with headers for columns and rows, and says when it was checked.
      const table = html.match(/<table class="cmp-table">([\s\S]*?)<\/table>/)[1];
      assert.match(table, /<caption>/);
      assert.match(table, new RegExp(`<th scope="col" class="us">Venn</th>\\s*<th scope="col">${name}</th>`));
      assert.ok((table.match(/<th scope="row">/g) || []).length >= 6, path);
      for (const row of table.match(/<tr>[\s\S]*?<\/tr>/g).slice(1)) assert.equal(row.match(/<td/g).length, 2, row);
      assert.ok(text(html).includes('Comparison as of October 2026. Features change, so check their sites.'), path);
      // A fair word for the other tool, and how to switch.
      assert.ok(html.includes(`<h2 id="fair">Where ${name} shines</h2>`), path);
      assert.ok(html.includes('<h2 id="switch">How to switch in 1 minute</h2>'), path);
      // One of the app's own phone screens, light and dark, described for screen readers.
      const shot = html.match(/<figure class="cmp-shot">([\s\S]*?)<\/figure>/)[1];
      assert.match(shot, /srcset="\/img\/shots\/\w+-dark\.webp"/);
      assert.match(shot, /src="\/img\/shots\/\w+-light\.webp"/);
      assert.match(shot, /alt="[^"]{40,}"/);
    }
  });
});

test('compare pages: the questions for search engines are the ones on the page, word for word', async () => {
  await withServer(async (base) => {
    for (const path of PAGES.slice(1)) {
      const html = await (await fetch(base + path)).text();
      const faq = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      assert.equal(faq['@context'], 'https://schema.org');
      assert.equal(faq['@type'], 'FAQPage');
      const shown = [...html.matchAll(/<details>\s*<summary>([^<]+)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)].map(
        ([, q, a]) => [q, text(a)],
      );
      assert.ok(shown.length >= 4, path);
      assert.deepEqual(
        faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]),
        shown,
        path,
      );
      for (const q of faq.mainEntity) {
        assert.equal(q['@type'], 'Question');
        assert.equal(q.acceptedAnswer['@type'], 'Answer');
      }
    }
  });
});

test('compare pages: every link within the site goes somewhere real, and the site links to them', async () => {
  await withServer(async (base) => {
    const checked = new Set();
    for (const path of PAGES) {
      const html = await (await fetch(base + path)).text();
      for (const [, href] of html.matchAll(/(?:href|src|srcset)="(\/[^"#?]*)/g)) {
        if (checked.has(href)) continue;
        checked.add(href);
        assert.equal((await fetch(base + href)).status, 200, `${path} → ${href}`);
      }
      // Each page reaches the others.
      for (const other of PAGES) if (other !== path) assert.ok(html.includes(`href="${other}"`), `${path} → ${other}`);
    }
    assert.ok(checked.has('/new'));
    // The footer of the home page and the other site pages links to /compare.
    for (const path of ['/', '/templates', '/templates/friendsgiving', '/privacy']) {
      const html = await (await fetch(base + path)).text();
      assert.match(html, /<nav aria-label="Footer">[\s\S]*<a href="\/compare">Compare<\/a>[\s\S]*<\/nav>/, path);
    }
    // Anything else under /compare is a real 404.
    assert.equal((await fetch(`${base}/compare/nope`)).status, 404);
  });
});
