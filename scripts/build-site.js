// Builds the GitHub Pages site into site/: a product page plus the docs, rendered from the
// repository's Markdown files. `npm run site`. Set APP_URL to link the "Open Venn" button to a
// hosted instance.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'site');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const REPO = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''); // https://github.com/owner/repo
const APP_URL = process.env.APP_URL || '';

// Docs pages, in sidebar order: [source in the repo, page in the site, sidebar title]
const DOCS = [
  ['README.md', 'docs/index.html', 'Overview'],
  ['docs/NOTIFICATIONS.md', 'docs/notifications.html', 'Notifications'],
  ['docs/CALENDARS.md', 'docs/calendars.html', 'Calendars'],
  ['docs/AI.md', 'docs/ai.html', 'AI features'],
  ['docs/MAINTAINING.md', 'docs/maintaining.html', 'Maintaining'],
  ['docs/CI.md', 'docs/ci.html', 'CI and review'],
  ['CONTRIBUTING.md', 'docs/contributing.html', 'Contributing'],
  ['SECURITY.md', 'docs/security.html', 'Security'],
  ['CODE_OF_CONDUCT.md', 'docs/code-of-conduct.html', 'Code of conduct'],
].filter(([src]) => existsSync(join(root, src)));
const pageFor = new Map(DOCS.map(([src, page]) => [src, page]));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

// GitHub-style heading ids, so links like README.md#self-hosting keep working.
const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

/** Point links from a page that came from `src` (a repo path) at the right place on the site. */
function rewriteLinks(html, src, page) {
  const fromDir = posix.dirname(page);
  return html.replace(/(href|src|srcset)="([^"]+)"/g, (whole, attr, url) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) return whole; // external, mailto:, in-page
    const [path, hash = ''] = url.split('#');
    const target = posix.normalize(posix.join(posix.dirname(src), path));
    let to;
    if (pageFor.has(target)) to = posix.relative(fromDir, pageFor.get(target)) || posix.basename(pageFor.get(target));
    else if (target.startsWith('docs/') && /\.(png|gif|svg|jpe?g|webp)$/.test(target))
      to = posix.relative(fromDir, `assets/${target.slice('docs/'.length)}`);
    else to = `${REPO}/blob/main/${target}`; // anything else: view it on GitHub
    return `${attr}="${to}${hash ? `#${hash}` : ''}"`;
  });
}

function layout({ title, description, page, body, nav }) {
  const rel = (p) => posix.relative(posix.dirname(page), p) || posix.basename(p);
  const current = (p) => (p === page || (p === 'docs/index.html' && page.startsWith('docs/')) ? ' aria-current="page"' : '');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <link rel="icon" href="${rel('favicon.svg')}" type="image/svg+xml">
  <link rel="stylesheet" href="${rel('site.css')}">
</head>
<body>
  <header class="top">
    <div class="wrap">
      <a class="brand" href="${rel('index.html')}"><img src="${rel('assets/logo.svg')}" width="36" height="24" alt="">Venn</a>
      <nav aria-label="Site">
        <a href="${rel('index.html')}"${current('index.html')}>Product</a>
        <a href="${rel('docs/index.html')}"${current('docs/index.html')}>Docs</a>
        <a href="${REPO}">GitHub</a>
      </nav>
    </div>
  </header>
  ${nav ?? ''}${body}
  <footer>
    <div class="wrap">
      <span>Venn is free and open source (MIT).</span>
      <span><a href="${REPO}">Source code</a> · <a href="${REPO}/issues">Report an issue</a> · <a href="${rel('docs/security.html')}">Security</a></span>
    </div>
  </footer>
</body>
</html>
`;
}

function landing() {
  const shot = (name, alt, extra = '') =>
    `<picture><source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/${name}-dark.png"><img src="assets/screenshots/${name}-light.png" alt="${esc(alt)}" loading="lazy"${extra}></picture>`;
  const primary = APP_URL
    ? `<a class="btn btn-primary" href="${esc(APP_URL)}">Open Venn</a>`
    : `<a class="btn btn-primary" href="docs/index.html#quick-start">Get started</a>`;
  const features = [
    ['Free, no accounts', 'Nobody signs up, not even the organizer. No ads, no trackers.'],
    ['Fast to set up', 'Pick dates, add a few times, copy them to every day with one click.'],
    ['Made for phones', 'Big Yes / If needed / No buttons, live tallies, and a Save button that stays in reach.'],
    ['Time zones handled', 'Everyone sees times in their own time zone, automatically.'],
    ['Picks the best time', 'Options ranked by who can make it, then by who gave a firm yes.'],
    ['Checks your calendar', 'Fill in answers from Google Calendar or Outlook. Only busy/free times, read in your browser.'],
    ['Tells you who answered', 'Email, Slack, Discord or any webhook, whenever someone responds.'],
    ['Yours to run', 'Host it free on Cloudflare or on any server with Node. MIT licensed.'],
  ]
    .map(([h, p]) => `<div class="feature"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`)
    .join('\n');
  const body = `
  <main>
    <div class="wrap hero">
      <img src="assets/logo.svg" width="120" height="80" alt="">
      <h1>Find a time that works for everyone</h1>
      <p>Free scheduling polls. Propose a few times, share one link, and see where everyone's availability overlaps. No accounts. No ads. No tracking.</p>
      <div class="btn-row">${primary}<a class="btn" href="${REPO}">View on GitHub</a></div>
      <div class="demo"><img src="assets/demo.gif" width="880" alt="Creating a poll, answering it, and picking the time everyone can make"></div>
    </div>

    <section class="band" aria-labelledby="why">
      <div class="wrap">
        <h2 id="why">Why Venn</h2>
        <p class="lead">Everyone's availability is a circle. Venn finds where they overlap.</p>
        <div class="features">${features}</div>
      </div>
    </section>

    <section aria-labelledby="how">
      <div class="wrap">
        <h2 id="how">How it works</h2>
        <p class="lead">Three steps, no sign-up.</p>
        <div class="steps">
          <div class="step"><div><span class="num">1</span><h3>Propose some times</h3><p>Pick the days, add the times you'd like to suggest, and share one link.</p></div>${shot('create', 'Creating a poll: picking dates and adding times')}</div>
          <div class="step phone"><div><span class="num">2</span><h3>Everyone answers, on any device</h3><p>People enter their name and tap what works. They can check their calendar first, and no app or account is needed.</p></div>${shot('mobile', 'Answering a poll on a phone')}</div>
          <div class="step"><div><span class="num">3</span><h3>See the overlap and pick a time</h3><p>Best times are ranked for you. Pick one and everyone gets Google, Outlook and Apple calendar links.</p></div>${shot('results', 'Poll results with the best times ranked')}</div>
        </div>
      </div>
    </section>

    <section class="band" aria-labelledby="privacy">
      <div class="wrap">
        <h2 id="privacy">Private by design</h2>
        <div class="features">
          <div class="feature"><h3>No accounts or cookies</h3><p>Venn stores only what people type into a poll: its title, names and answers.</p></div>
          <div class="feature"><h3>Links are the keys</h3><p>Organizer and edit links carry a secret the server only ever stores as a hash.</p></div>
          <div class="feature"><h3>Your calendar stays with you</h3><p>Calendar checks run in your browser. Event titles are never read and tokens never reach the server.</p></div>
        </div>
      </div>
    </section>

    <section class="cta" aria-labelledby="build">
      <div class="wrap">
        <h2 id="build">Run it yourself, or help build it</h2>
        <p class="lead">Venn is open source. Deploy it for free on Cloudflare in a few minutes, or join in on GitHub.</p>
        <div class="btn-row"><a class="btn btn-primary" href="docs/index.html#self-hosting">Self-hosting guide</a><a class="btn" href="docs/contributing.html">Contributing</a></div>
      </div>
    </section>
  </main>`;
  return layout({
    title: 'Venn: find a time that works for everyone',
    description:
      'Free, open-source scheduling polls. Propose times, share a link, see when everyone overlaps. No accounts, no ads.',
    page: 'index.html',
    body,
  });
}

function docPage([src, page, title]) {
  const md = readFileSync(join(root, src), 'utf8');
  const html = rewriteLinks(marked.parse(md), src, page);
  const nav = `<div class="wrap docs"><aside><nav aria-label="Documentation">${DOCS.map(
    ([, p, t]) =>
      `<a href="${posix.relative(posix.dirname(page), p) || posix.basename(p)}"${p === page ? ' aria-current="page"' : ''}>${esc(t)}</a>`,
  ).join('')}</nav></aside>`;
  return layout({
    title: `${title} · Venn docs`,
    description: `Venn documentation: ${title}.`,
    page,
    nav,
    body: `<main class="prose">${html}</main></div>`,
  });
}

// ---------- build ----------
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'docs'), { recursive: true });
cpSync(join(root, 'docs'), join(out, 'assets'), { recursive: true, filter: (p) => !p.endsWith('.md') });
cpSync(join(root, 'public', 'favicon.svg'), join(out, 'favicon.svg'));
cpSync(join(root, 'site-src', 'site.css'), join(out, 'site.css'));
writeFileSync(join(out, '.nojekyll'), ''); // serve files as-is
writeFileSync(join(out, 'index.html'), landing());
for (const doc of DOCS) writeFileSync(join(out, doc[1]), docPage(doc));

// Every local link and image on the site must exist.
const broken = [];
for (const file of ['index.html', ...DOCS.map((d) => d[1])]) {
  const html = readFileSync(join(out, file), 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src|srcset)="([^"]+)"/g)) {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) continue;
    const target = join(out, posix.dirname(file), url.split('#')[0]);
    if (!existsSync(target)) broken.push(`${file}: ${url}`);
  }
}
if (broken.length) {
  console.error(`Broken links on the site:\n${broken.join('\n')}`);
  process.exit(1);
}
const count = readdirSync(join(out, 'docs')).length + 1;
console.log(`Built site/ (${count} pages)${APP_URL ? `, "Open Venn" → ${APP_URL}` : ''}`);
