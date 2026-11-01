// Builds the developer docs (docs.venn.day) into site/, rendered from the repository's Markdown
// files. `npm run site`. APP_URL sets where "Open Venn" points (default https://venn.day).

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'site');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const REPO = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''); // https://github.com/owner/repo
const APP_URL = process.env.APP_URL || 'https://venn.day';

// Docs pages, in sidebar order: [source in the repo, page in the site, sidebar title, sidebar group]
const DOCS = [
  ['docs/INTRODUCTION.md', 'index.html', 'Introduction', 'Get started'],
  ['docs/SELF-HOSTING.md', 'self-hosting.html', 'Self-hosting', 'Get started'],
  ['docs/API.md', 'api.html', 'API', 'Reference'],
  ['docs/NOTIFICATIONS.md', 'notifications.html', 'Notifications', 'Reference'],
  ['docs/CALENDARS.md', 'calendars.html', 'Calendars', 'Reference'],
  ['docs/ACCOUNTS.md', 'accounts.html', 'Accounts', 'Reference'],
  ['docs/EMBED.md', 'embed.html', 'White label and embedding', 'Reference'],
  ['docs/AI.md', 'ai.html', 'AI features', 'Reference'],
  ['docs/MCP.md', 'mcp.html', 'Claude, ChatGPT and MCP', 'Reference'],
  ['docs/USAGE-STATS.md', 'usage-stats.html', 'Usage stats', 'Reference'],
  ['CONTRIBUTING.md', 'contributing.html', 'Contributing', 'Project'],
  ['docs/CI.md', 'ci.html', 'CI and review', 'Project'],
  ['docs/MAINTAINING.md', 'maintaining.html', 'Maintaining', 'Project'],
  ['SECURITY.md', 'security.html', 'Security', 'Project'],
  ['CODE_OF_CONDUCT.md', 'code-of-conduct.html', 'Code of conduct', 'Project'],
].filter(([src]) => existsSync(join(root, src)));
const pageFor = new Map(DOCS.map(([src, page]) => [src, page]));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '') // drops punctuation, like GitHub's anchors
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

// Images from public/ that a page shows (the retro banner), copied into assets/public/ after the build.
const publicImages = new Set();

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
    else if (attr !== 'href' && target.startsWith('public/') && /\.(png|gif|svg|jpe?g|webp)$/.test(target)) {
      publicImages.add(target);
      to = posix.relative(fromDir, `assets/${target}`);
    } else to = `${REPO}/blob/main/${target}`; // anything else: view it on GitHub
    return `${attr}="${to}${hash ? `#${hash}` : ''}"`;
  });
}

const LOGO = `<img src="logo.svg?v=6" width="26" height="26" alt="">`;
// The GitHub mark, only on links to the repository (BRAND.md).
const GITHUB_MARK = `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

function sidebar(page) {
  const groups = [...new Set(DOCS.map((d) => d[3]))];
  return groups
    .map(
      (g) =>
        `<p class="group">${esc(g)}</p>` +
        DOCS.filter((d) => d[3] === g)
          .map(([, p, t]) => `<a href="${p}"${p === page ? ' aria-current="page"' : ''}>${esc(t)}</a>`)
          .join(''),
    )
    .join('');
}

function docPage([src, page, title]) {
  const md = readFileSync(join(root, src), 'utf8');
  const html = rewriteLinks(marked.parse(md), src, page);
  const fullTitle = page === 'index.html' ? 'Build with Venn · Venn developer docs' : `${title} · Venn developer docs`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(`Developer documentation for Venn, the open-source scheduling poll: ${title}.`)}">
  <meta property="og:title" content="${esc(fullTitle)}">
  <link rel="icon" href="favicon.ico?v=5" sizes="32x32">
  <link rel="icon" href="favicon.svg?v=5" type="image/svg+xml">
  <meta name="theme-color" content="#0d0221">
  <link rel="stylesheet" href="site.css">
</head>
<body>
  <div class="scene" aria-hidden="true"></div>
  <a class="skip" href="#content">Skip to content</a>
  <header class="top">
    <div class="bar">
      <a class="brand" href="index.html">${LOGO}Venn <span class="tag">Docs</span></a>
      <nav aria-label="Site">
        <a href="${esc(APP_URL)}">Open Venn <span aria-hidden="true">↗</span></a>
        <a class="gh" href="${REPO}">${GITHUB_MARK}GitHub</a>
      </nav>
    </div>
  </header>
  <div class="layout">
    <aside>
      <nav class="toc side" aria-label="Documentation">${sidebar(page)}</nav>
      <details class="toc menu">
        <summary>Contents: ${esc(title)}</summary>
        <nav aria-label="Documentation (menu)">${sidebar(page)}</nav>
      </details>
    </aside>
    <main id="content" class="prose">${html}
      <p class="edit"><a href="${REPO}/edit/main/${src}">Edit this page on GitHub</a></p>
    </main>
  </div>
  <footer>
    <div class="bar">
      <span>Venn is free and open source (MIT).</span>
      <span><a href="${esc(APP_URL)}">venn.day</a> · <a href="${REPO}">Source code</a> · <a href="${REPO}/issues">Report an issue</a></span>
    </div>
  </footer>
</body>
</html>
`;
}

// ---------- build ----------
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'docs'), join(out, 'assets'), { recursive: true, filter: (p) => !p.endsWith('.md') });
// The docs have their own tab icon; the header shows the website's retro logo, as the docs are retro.
cpSync(join(root, 'site-src', 'favicon.svg'), join(out, 'favicon.svg'));
cpSync(join(root, 'site-src', 'favicon.ico'), join(out, 'favicon.ico'));
cpSync(join(root, 'public', 'logo-retro.svg'), join(out, 'logo.svg'));
cpSync(join(root, 'public', 'fonts'), join(out, 'fonts'), { recursive: true });
cpSync(join(root, 'site-src', 'site.css'), join(out, 'site.css'));
writeFileSync(join(out, '.nojekyll'), ''); // serve files as-is
for (const doc of DOCS) writeFileSync(join(out, doc[1]), docPage(doc));
for (const img of publicImages) cpSync(join(root, img), join(out, 'assets', img));

// Every local link and image on the site must exist.
const broken = [];
for (const file of DOCS.map((d) => d[1])) {
  const html = readFileSync(join(out, file), 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src|srcset)="([^"]+)"/g)) {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) continue;
    const target = join(out, posix.dirname(file), url.split(/[?#]/)[0]);
    if (!existsSync(target)) broken.push(`${file}: ${url}`);
  }
}
if (broken.length) {
  console.error(`Broken links on the site:\n${broken.join('\n')}`);
  process.exit(1);
}
console.log(`Built site/ (${DOCS.length} pages), "Open Venn" → ${APP_URL}`);
