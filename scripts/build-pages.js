// Writes the website's landing pages from pages/pages.js: `npm run pages`.
//   public/templates/<slug>.html     a page per kind of plan
//   public/templates.html            the list of them all
//   public/sitemap.xml               every page search engines should find
//   public/llms.txt                  the same, as a short guide for AI assistants
// test/pages.test.js fails if these drift from pages.js, so edit pages.js and run this again.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { ORIGIN, PAGES, TEMPLATE_PAGES } from '../pages/pages.js';

const root = new URL('..', import.meta.url);

/** For text in the page. */
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
/** For attribute values, which are always in double quotes. */
const attr = (s) => esc(s).replace(/"/g, '&quot;');
/** Escaped, with *words* in italics. */
const em = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
const plain = (s) => s.replace(/\*/g, '');
const pageOf = (slug) => PAGES.find((p) => p.slug === slug);
/** Where a page's picture for link previews is (scripts/og-image.js draws it). */
export const ogImage = (p) => `/og/${p.section}-${p.slug}.png`;
/** The button's link: the template's form, saying which page it came from (for usage stats). */
const startUrl = (p) => (p.template ? `/new?template=${p.template}&from=${p.slug}` : `/new?from=${p.slug}`);

function head({ title, description, path, ogTitle, ogDescription, image, jsonLd }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="referrer" content="no-referrer" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#faf8f4" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0f1112" media="(prefers-color-scheme: dark)" />
<title>${esc(title)}</title>
<meta name="description" content="${attr(description)}" />
<link rel="canonical" href="${ORIGIN}${path}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Venn" />
<meta property="og:url" content="${ORIGIN}${path}" />
<meta property="og:title" content="${attr(ogTitle)}" />
<meta property="og:description" content="${attr(ogDescription)}" />
<meta property="og:image" content="${ORIGIN}${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.ico?v=5" sizes="32x32" />
<link rel="icon" href="/favicon.svg?v=5" type="image/svg+xml" />
<link rel="preload" href="/fonts/orbitron-latin-900-normal.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="/site.css" />
    <script src="/retro-mode.js"></script>
${jsonLd.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
<div class="wrap nav">
<a href="/" class="brand"><img src="/favicon.svg?v=5" width="28" height="28" alt="" class="logo-classic" /><img src="/logo-retro.svg?v=1" width="28" height="28" alt="" class="logo-retro" /> Venn</a>
<nav class="nav-links" aria-label="Main">
<a href="/new" class="btn btn-sm">Create a Venn</a>
<details class="menu">
<summary aria-label="Menu"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></summary>
<div class="menu-panel">
<a href="/brand">For organizations</a>
<a href="https://docs.venn.day">For developers</a>
<a href="/#contact">Contact</a>
</div>
</details>
</nav>
</div>
</header>`;
}

const FOOTER = `<footer class="wrap footer">
<div class="footer-dev">
<p><strong>Build on Venn.</strong> It's open source, with a free API and polls you can put on your own website.</p>
<p class="footer-dev-links">
<a href="https://docs.venn.day" class="footer-btn">Developer docs</a>
<a href="https://github.com/sephmard/venn" class="footer-btn"><svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> GitHub</a>
</p>
</div>
<span>© Venn · Free and open source</span>
<nav aria-label="Footer">
<a href="/privacy">Privacy</a>
<a href="/terms">Terms</a>
<a href="/#contact">Contact</a>
<button type="button" class="classic-switch" role="switch" aria-checked="false">Classic mode</button>
</nav>
</footer>
<script type="module" src="/menu.js"></script>
</body>
</html>`;

const faqLd = (faq) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});
const crumbsLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: ORIGIN + path })),
});

const faqHtml = (faq) => `<section class="prose faq" aria-labelledby="faq">
<h2 id="faq">Questions</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
</section>`;

const relatedHtml = (p, heading) => `<section class="tpl-list" aria-labelledby="more">
<h2 id="more">${esc(heading)}</h2>
<ul class="tpl-more">
${p.related.map((s) => `<li><a href="${pageOf(s).path}">${esc(pageOf(s).name)}</a></li>`).join('\n')}
<li><a href="/templates">All templates</a></li>
</ul>
</section>`;

/** The example poll: a few dates, how many can make each, the best one picked. */
function pollHtml({ name, of, rows }) {
  const top = Math.max(...rows.map(([, n]) => n));
  const best = rows.find(([, n]) => n === top)[0];
  const label = `A Venn poll for ${name}: ${rows.map(([d, n]) => `${d}, ${n} of ${of}`).join(', ')}. ${best} is the best date.`;
  return `<figure class="result" role="img" aria-label="${attr(label)}">
<div aria-hidden="true">
<p class="result-head"><img src="/favicon.svg?v=5" width="20" height="20" alt="" class="logo-classic" /><img src="/logo-retro.svg?v=1" width="20" height="20" alt="" class="logo-retro" /> ${esc(name)}</p>
<ul class="votes">
${rows.map(([d, n]) => `<li${d === best ? ' class="best"' : ''}><span>${esc(d)}</span><i style="--n: ${Math.round((100 * n) / of)}%"></i><b>${n} of ${of}</b></li>`).join('\n')}
</ul>
<p class="result-label">${top === of ? 'Everyone can make it' : `${top} of ${of} can make it`}</p>
<p class="result-date">${esc(best)}</p>
<p class="result-cta">Add to calendar</p>
</div>
</figure>`;
}

function templatePage(p) {
  const [headline, line] = p.share;
  const crumbs = [
    ['Templates', '/templates'],
    [p.name, p.path],
  ];
  return `${head({
    title: p.title,
    description: p.description,
    path: p.path,
    ogTitle: p.ogTitle || plain(headline),
    ogDescription: p.ogDescription || line,
    image: ogImage(p),
    jsonLd: [faqLd(p.faq), crumbsLd(crumbs)],
  })}
<main id="main">
<div class="wrap page tpl-page">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/templates">Templates</a> / <span aria-current="page">${esc(p.name)}</span></nav>
<div class="tpl-hero">
<div>
<h1>${em(p.h1)}</h1>
<p class="lede">${esc(p.lede)}</p>
<a class="btn btn-lg" href="${attr(startUrl(p))}">${esc(p.cta)}</a>
<p class="tpl-small">${esc(p.small)}</p>
</div>
${pollHtml(p.poll)}
</div>
<div class="tpl-body">
<section class="prose" aria-labelledby="how">
<h2 id="how">${esc(p.how.heading)}</h2>
<ol class="steps">
${p.how.steps.map(([b, t]) => `<li><b>${esc(b)}</b> ${esc(t)}</li>`).join('\n')}
</ol>
</section>
<section aria-labelledby="tips">
<h2 id="tips">${esc(p.tips.heading)}</h2>
<ul class="benefits">
${p.tips.items.map(([h, t]) => `<li><h3>${esc(h)}</h3><p>${esc(t)}</p></li>`).join('\n')}
</ul>
</section>
${
  p.timeline
    ? `<section class="prose" aria-labelledby="timeline">
<h2 id="timeline">${esc(p.timeline.heading)}</h2>
<ol class="timeline">
${p.timeline.items.map(([b, t]) => `<li><b>${esc(b)}</b>${esc(t)}</li>`).join('\n')}
</ol>
</section>`
    : ''
}
${faqHtml(p.faq)}
${relatedHtml(p, 'More templates')}
</div>
</div>
<section class="wrap closing">
<h2>Make it <em>a date.</em></h2>
<a href="${attr(startUrl(p))}" class="btn btn-lg">${esc(p.cta)}</a>
</section>
</main>
${FOOTER}`;
}

function hub() {
  const card = (p) =>
    `<li><a class="tpl-card" href="${p.path}"><strong>${esc(p.name)}</strong><span>${esc(p.card)}</span><em>See the template →</em></a></li>`;
  const group = (g) => TEMPLATE_PAGES.filter((p) => p.group === g).map((p) => card({ ...p, path: `/templates/${p.slug}` }));
  return `${head({
    title: 'Poll templates for group plans: book clubs, trips, game nights and more · Venn',
    description:
      'Poll templates for book clubs, game nights, D&D, trips, family reunions, holiday parties and more. Pick one, share a link, and find the day that works. Free.',
    path: '/templates',
    ogTitle: 'Templates for every get-together',
    ogDescription:
      'Book clubs, game nights, trips, holiday parties and more: pick a template, share one link, and find the day that works for everyone.',
    image: '/og.png',
    jsonLd: [],
  })}
<main id="main">
<div class="wrap page tpl-page tpl-list">
<h1>Templates for <em>every get-together.</em></h1>
<p class="lede">Start a poll with the plan already filled in: how long it is, the time of day, and a note for everyone. Then suggest a few dates and share one link.</p>
<section aria-labelledby="season">
<h2 id="season">For the holidays</h2>
<ul class="tpl-cards">
${group('season').join('\n')}
</ul>
</section>
<section aria-labelledby="everyday">
<h2 id="everyday">For any time of year</h2>
<ul class="tpl-cards">
${group('everyday').join('\n')}
</ul>
</section>
<section aria-labelledby="team">
<h2 id="team">For your organization</h2>
<ul class="tpl-cards">
<li><a class="tpl-card" href="/brand"><strong>Your own template</strong><span>Your logo, colour and font on every poll your team sends. Free with an account.</span><em>Make yours →</em></a></li>
</ul>
</section>
<section aria-labelledby="quick">
<h2 id="quick">Or jump straight in</h2>
<ul class="tpl-more">
${[
  ['dinner', 'pick', 'Dinner'],
  ['drinks', 'pick', 'Drinks'],
  ['coffee', 'pick', 'Coffee'],
  ['brunch', 'pick', 'Brunch'],
  ['hike', 'pick', 'Hike'],
  ['party', 'pick', 'Party'],
]
  .map(([t, , l]) => `<li><a href="/new?template=${t}">${l}</a></li>`)
  .join('\n')}
</ul>
</section>
</div>
<section class="wrap closing">
<h2>Or start <em>from scratch.</em></h2>
<a href="/new" class="btn btn-lg">Create a Venn</a>
</section>
</main>
${FOOTER}`;
}

const sitemap = () => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/templates', ...TEMPLATE_PAGES.map((p) => `/templates/${p.slug}`), '/privacy', '/terms'].map((path) => `  <url><loc>${ORIGIN}${path}</loc></url>`).join('\n')}
</urlset>
`;

/**
 * A plain guide for language models (llmstxt.org): what Venn is, in a few facts they can quote,
 * and links to every public page, so AI assistants can answer "how do I find a date for…" well.
 */
const llms = () => `# Venn

> Venn is a free, open-source scheduling poll for groups. You make a Venn: tap the days (or times) that could work, share one link, everyone marks when they're free, and Venn shows where everyone overlaps. Nobody needs an account, there are no ads, and it works on any phone.

Facts:

- Free for everyone, every feature. No ads, no paid plan, no accounts for organizers or guests.
- A Venn: guests mark when they're available or available if needed, by whole days, mornings, afternoons and evenings, or hours, and Venn finds the overlap, including several days in a row for trips.
- Deciding what or where (https://venn.day/new/topic): guests say yes, if needed or no to each option (a place, a book), or answer one yes-or-no question; the organizer picks one, then finds a date for it.
- The organizer picks the date, and everyone can add it to Google Calendar, Outlook or Apple Calendar.
- Times show in each person's own time zone. Organizers can hide names or answers and collect emails.
- Open source (MIT) at https://github.com/sephmard/venn. It runs on Cloudflare Workers or Node, and has a JSON API.
- Privacy: polls are private to people with the link; only SHA-256 hashes of edit links are stored; usage stats are anonymous daily counts.

## Start a poll

- [Create a Venn](${ORIGIN}/new): no sign-up.
- [All templates](${ORIGIN}/templates): polls with the plan filled in.

## Templates

${TEMPLATE_PAGES.map((p) => `- [${p.name}](${ORIGIN}/templates/${p.slug}): ${p.card}`).join('\n')}

## For AI assistants and agents

- MCP server: \`${ORIGIN}/api/mcp\` (Streamable HTTP, no sign-in or key). Tools: \`create_venn\` makes a poll from whole days or specific times (to find a date) or from options (to vote on what or where, optionally pick one) and returns its share link and private organizer link; \`get_venn_results\` reads who answered and which days or options work best, saying plainly when nobody has answered or options are tied. [Connecting it](https://docs.venn.day/mcp.html).
- JSON API, no key needed: \`POST ${ORIGIN}/api/events\` with \`{ "title", "timezone", "dates": ["YYYY-MM-DD", …], "startMinute": 0, "endMinute": 1440, "slotMinutes": 1440, "durationMinutes": 1440 }\` for whole days, or \`{ "title", "timezone", "mode": "options", "options": [{ "start", "end" }] }\` for times (UTC milliseconds), returns \`{ id, adminToken }\`. Share \`${ORIGIN}/e/<id>\`; \`${ORIGIN}/e/<id>#admin=<adminToken>\` manages it. \`GET ${ORIGIN}/api/events/<id>\` returns the poll, its \`slots\` and each participant's \`availability\` (slot start → 2 available, 1 if needed). [Full API](https://docs.venn.day/api.html).

## Optional

- [Developer docs and API](https://docs.venn.day): self-hosting, the API, notifications and calendars.
- [Privacy](${ORIGIN}/privacy): what Venn stores, and what it doesn't.
- [Terms](${ORIGIN}/terms): the terms for using Venn.
`;

/** Every file this writes, formatted as Prettier would: { 'public/…': text }. */
export async function build() {
  const files = {
    ...Object.fromEntries(PAGES.map((p) => [`public${p.path}.html`, templatePage(p)])),
    'public/templates.html': hub(),
  };
  const config = await prettier.resolveConfig(new URL('public/index.html', root).pathname);
  for (const [path, text] of Object.entries(files)) files[path] = await prettier.format(text, { ...config, parser: 'html' });
  files['public/sitemap.xml'] = sitemap();
  files['public/llms.txt'] = llms();
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, text] of Object.entries(await build())) {
    const file = new URL(path, root).pathname;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`wrote ${path}`);
  }
}
