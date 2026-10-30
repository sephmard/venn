// Renders the link-preview images (1200×630): `npm run og`.
//   public/og.png      the home page, and polls still asking (src/preview.js), without Finn
//   public/og-set.png  polls whose date is picked
//   public/og-retro.png, og-set-retro.png  the same two for polls in the retro look
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
const orbitron = asset('fonts/orbitron-latin-900-normal.woff2');
const retroLogo = `data:image/svg+xml;base64,${asset('logo-retro.svg')}`;

const page = ({ headline, line, extra = '', cls = '', finn = true }) => `<!doctype html>
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
${finn ? `<img class="finn" src="${dog}" alt="">` : ''}
<div class="text ${cls}">
  <div class="brand"><img src="${logo}" width="44" height="44" alt="">Venn</div>
  <h1>${headline}</h1>
  ${line}
</div>`;

// The retro look's (retro-app.css): a synthwave night, a striped sun on a neon grid, chrome
// headlines and the neon logo. Finn stays himself, smooth.
const retroPage = ({ headline, line, finn = true }) => `<!doctype html>
<style>
  @font-face { font-family: O; font-weight: 900; src: url(data:font/woff2;base64,${orbitron}); }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; position: relative; color: #f5f0ff;
    background: linear-gradient(180deg, #0d0221 0%, #160634 55%, #2a0845 100%);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .stars { position: absolute; inset: 0;
    background: radial-gradient(2px 2px at 8% 14%, #fff9 50%, transparent 51%), radial-gradient(2px 2px at 46% 8%, #fff8 50%, transparent 51%),
      radial-gradient(2px 2px at 58% 30%, #fff7 50%, transparent 51%), radial-gradient(2px 2px at 92% 12%, #fff9 50%, transparent 51%),
      radial-gradient(2px 2px at 30% 40%, #fff6 50%, transparent 51%); }
  .sun { position: absolute; right: 130px; top: 80px; width: 400px; height: 400px; border-radius: 50%;
    background: linear-gradient(180deg, #ffd319 0%, #ff8c42 40%, #ff2975 70%, #f222ff 100%);
    -webkit-mask: linear-gradient(180deg, #000 52%, transparent 52% 56%, #000 56% 64%, transparent 64% 69%, #000 69% 76%, transparent 76% 82%, #000 82% 88%, transparent 88%);
    box-shadow: 0 0 80px -10px #ff2975; opacity: 0.9; }
  .floor { position: absolute; left: -200px; right: -200px; bottom: -20px; height: 300px; transform: perspective(260px) rotateX(55deg);
    transform-origin: bottom; border-top: 3px solid #ff3cac; box-shadow: 0 -10px 40px -6px #ff3cac;
    background: repeating-linear-gradient(90deg, transparent 0 58px, rgb(45 226 230 / 0.7) 58px 61px),
      repeating-linear-gradient(0deg, transparent 0 38px, rgb(255 60 172 / 0.7) 38px 41px), #12042b; }
  .venn { position: absolute; right: 120px; top: 70px; width: 420px; height: 420px; filter: drop-shadow(0 0 24px rgb(45 226 230 / 0.6)); }
  .finn { position: absolute; right: 250px; bottom: 30px; height: 420px; filter: drop-shadow(0 0 30px rgb(255 60 172 / 0.7)); }
  .text { position: absolute; left: 80px; top: 0; bottom: 120px; width: 640px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 14px; font: 900 30px O; letter-spacing: 0.08em; margin-bottom: 30px; }
  h1 { font: 900 76px/1.02 O; text-transform: uppercase; margin: 0 0 24px; color: transparent; -webkit-background-clip: text; background-clip: text;
    background-image: linear-gradient(180deg, #fff 0%, #e4e9ff 38%, #9d8fd6 50%, #fff 53%, #cdd5ff 100%);
    filter: drop-shadow(0 0 18px rgb(255 60 172 / 0.55)); }
  .set h1 { font-size: 112px; }
  p { font-size: 30px; line-height: 1.3; color: #c9bfec; margin: 0; }
  .pill { display: inline-flex; align-items: center; gap: 12px; align-self: flex-start; padding: 14px 26px; border-radius: 6px;
    border: 3px solid #2de2e6; color: #2de2e6; font: 900 26px O; letter-spacing: 0.06em; text-transform: uppercase;
    box-shadow: 0 0 22px -4px #2de2e6, 6px 6px 0 0 #ff3cac; }
</style>
<div class="stars"></div>
<div class="sun"></div>
<div class="floor"></div>
${finn ? `<img class="finn" src="${dog}" alt="">` : `<img class="venn" src="${retroLogo}" alt="">`}
<div class="text${finn ? ' set' : ''}">
  <div class="brand"><img src="${retroLogo}" width="48" height="48" alt="">VENN</div>
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
  // The site's own preview: just the circles, no Finn.
  'og.png': page({
    headline: 'Find the day that works for <em>everyone.</em>',
    line: '<p>Free group polls. No sign-up.</p>',
    finn: false,
  }),
  'og-set.png': page({
    headline: 'It’s <em>set.</em>',
    line: '<div class="pill"><span aria-hidden="true">✓</span> Date picked</div><p class="after">Add it to your calendar. See you there!</p>',
    extra: confetti,
    cls: 'set',
  }),
  'og-retro.png': retroPage({
    headline: 'Find the day that works',
    line: '<p>Free group polls. No sign-up.</p>',
    finn: false,
  }),
  'og-set-retro.png': retroPage({
    headline: 'It’s set',
    line: '<div class="pill"><span aria-hidden="true">✓</span> Date picked</div>',
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
