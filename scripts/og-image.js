// Renders the link-preview images (1200×630): `npm run og`.
//   public/og.png      the home page, and polls still asking (src/preview.js)
//   public/og-set.png  polls whose date is picked
//   public/og/<section>-<slug>.png  the landing pages in pages/pages.js
// Needs Playwright's Chromium (`npx playwright install chromium`, or set CHROMIUM_PATH). Matches
// DESIGN.md: warm paper, the serif, the Venn circles, and Finn the dog. Chat apps show these small,
// so the words are big and few.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { PAGES } from '../pages/pages.js';
import { ogImage } from './build-pages.js';

const asset = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url)).toString('base64');
const serif = asset('fonts/instrument-serif-latin-400-normal.woff2');
const serifItalic = asset('fonts/instrument-serif-latin-400-italic.woff2');
const logo = `data:image/svg+xml;base64,${asset('favicon.svg')}`;
const dog = `data:image/webp;base64,${asset('img/dog.webp')}`;

const page = ({ headline, line, extra = '', cls = '' }) => `<!doctype html>
<style>
  @font-face { font-family: S; src: url(data:font/woff2;base64,${serif}); }
  @font-face { font-family: S; font-style: italic; src: url(data:font/woff2;base64,${serifItalic}); }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; position: relative; background: #faf8f4; color: #16181a;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .text { position: absolute; left: 80px; top: 0; bottom: 0; width: 620px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 700; margin-bottom: 36px; }
  h1 { font: 400 100px/0.95 S; letter-spacing: -0.01em; margin: 0 0 28px; }
  em { color: #0b7a5c; }
  p { font-size: 30px; line-height: 1.3; color: #55585c; margin: 0; }
  .glow { position: absolute; right: -80px; top: -60px; width: 760px; height: 760px; border-radius: 50%;
    background: radial-gradient(closest-side, #c3f2de, transparent); }
  /* The logo itself, large, with Finn standing where the three circles meet. */
  .venn { position: absolute; right: 50px; top: 75px; width: 480px; height: 480px; }
  .finn { position: absolute; right: 222px; bottom: 30px; height: 440px; filter: drop-shadow(0 18px 24px rgb(22 24 26 / 0.18)); }
  .pill { display: inline-flex; align-items: center; gap: 12px; align-self: flex-start; margin-top: 12px; padding: 14px 26px;
    border-radius: 999px; background: #0b7a5c; color: #fff; font-size: 28px; font-weight: 600; }
  .set h1 { font-size: 150px; margin-bottom: 8px; }
  .landing h1 { font-size: 76px; }
  .after { margin-top: 28px; }
  .dot { position: absolute; border-radius: 50%; }
</style>
<div class="glow"></div>
<img class="venn" src="${logo}" alt="">
${extra}
<img class="finn" src="${dog}" alt="">
<div class="text ${cls}">
  <div class="brand"><img src="${logo}" width="44" height="44" alt="">Venn</div>
  <h1>${headline}</h1>
  ${line}
</div>`;

// A little confetti in the brand greens (and one amber), like the app's celebration.
const confetti = [
  [700, 70, 18, '#2fc497'],
  [760, 150, 12, '#e0a12e'],
  [1110, 70, 16, '#0b7a5c'],
  [1150, 210, 12, '#8fd9bf'],
  [690, 470, 14, '#14513f'],
  [1130, 520, 18, '#2fc497'],
  [880, 40, 10, '#0b7a5c'],
]
  .map(([x, y, s, c]) => `<span class="dot" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;background:${c}"></span>`)
  .join('');

const IMAGES = {
  'og.png': page({
    headline: 'Find the day that works for <em>everyone.</em>',
    line: '<p>Free group polls. No sign-up.</p>',
  }),
  'og-set.png': page({
    headline: 'It’s <em>set.</em>',
    line: '<div class="pill"><span aria-hidden="true">✓</span> Date picked</div><p class="after">Add it to your calendar. See you there!</p>',
    extra: confetti,
    cls: 'set',
  }),
};

// Each landing page: its own headline (*words* in green italics) and line.
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
for (const p of PAGES) {
  const [headline, line] = p.share;
  IMAGES[ogImage(p).slice(1)] = page({
    headline: esc(headline).replace(/\*([^*]+)\*/g, '<em>$1</em>'),
    line: `<p>${esc(line).replace(/-/g, '\u2011')}</p>`, // no line break at sign-up's hyphen
    cls: 'landing',
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [file, html] of Object.entries(IMAGES)) {
  await tab.setContent(html);
  await tab.evaluate(() => document.fonts.ready);
  const path = new URL(`../public/${file}`, import.meta.url).pathname;
  mkdirSync(dirname(path), { recursive: true });
  await tab.screenshot({ path });
  // WhatsApp skips preview images over about 300 KB, so squeeze to 256 colours with ImageMagick
  // when it's installed. It looks the same.
  try {
    execFileSync('convert', [path, '-dither', 'FloydSteinberg', '-colors', '256', `PNG8:${path}`]);
  } catch {
    console.warn('ImageMagick not found: the image is not squeezed');
  }
  console.log(`wrote public/${file} (${Math.round(statSync(path).size / 1024)} KB)`);
}
await browser.close();
