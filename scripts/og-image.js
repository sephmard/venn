// Renders the social preview image, public/og.png (1200×630): `npm run og`.
// Needs Playwright's Chromium (`npx playwright install chromium`). Matches DESIGN.md.

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const asset = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url)).toString('base64');
const serif = asset('fonts/instrument-serif-latin-400-normal.woff2');
const serifItalic = asset('fonts/instrument-serif-latin-400-italic.woff2');
const logo = `data:image/svg+xml;base64,${asset('favicon.svg')}`;

const html = `<!doctype html>
<style>
  @font-face { font-family: S; src: url(data:font/woff2;base64,${serif}); }
  @font-face { font-family: S; font-style: italic; src: url(data:font/woff2;base64,${serifItalic}); }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #faf8f4; color: #16181a;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .text { position: absolute; left: 80px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 700; margin-bottom: 40px; }
  h1 { font: 400 92px/0.95 S; letter-spacing: -0.01em; margin: 0 0 28px; }
  em { color: #0b7a5c; }
  p { font-size: 26px; color: #55585c; margin: 0; }
  .glow { position: absolute; right: -60px; top: -40px; width: 700px; height: 700px; border-radius: 50%;
    background: radial-gradient(closest-side, #c3f2de, transparent); }
  img.mark { position: absolute; right: 110px; top: 130px; width: 380px; height: 380px; }
</style>
<div class="text">
  <div class="brand">
    <img src="${logo}" width="44" height="44" alt="">
    Venn
  </div>
  <h1>Find the day that works for <em>everyone.</em></h1>
  <p>Free group polls. No sign-up.</p>
</div>
<div class="glow"></div>
<img class="mark" src="${logo}" alt="">`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname });
await browser.close();
console.log('wrote public/og.png');
