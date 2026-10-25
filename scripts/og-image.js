// Renders the social preview image, public/og.png (1200×630): `npm run og`.
// Needs Playwright's Chromium (`npx playwright install chromium`). Matches DESIGN.md.

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const asset = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url)).toString('base64');
const serif = asset('fonts/instrument-serif-latin-400-normal.woff2');
const serifItalic = asset('fonts/instrument-serif-latin-400-italic.woff2');

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
  svg.v { position: absolute; right: 40px; top: 75px; width: 500px; }
  .c { fill-opacity: .22; mix-blend-mode: multiply; }
</style>
<div class="text">
  <div class="brand">
    <svg viewBox="0 0 120 80" width="54" height="36"><defs><clipPath id="l"><circle cx="45" cy="40" r="30"/></clipPath></defs>
      <circle cx="45" cy="40" r="30" fill="#0b7a5c" fill-opacity=".28"/><circle cx="75" cy="40" r="30" fill="#0b7a5c" fill-opacity=".28"/>
      <circle cx="75" cy="40" r="30" fill="#0b7a5c" clip-path="url(#l)"/></svg>
    Venn
  </div>
  <h1>Find the time that works for <em>everyone.</em></h1>
  <p>Free scheduling polls. No sign-up.</p>
</div>
<svg class="v" viewBox="0 0 540 470">
  <defs><clipPath id="g"><circle cx="210" cy="170" r="150"/></clipPath><clipPath id="a"><circle cx="330" cy="170" r="150"/></clipPath></defs>
  <circle class="c" cx="210" cy="170" r="150" fill="#0b7a5c"/><circle class="c" cx="330" cy="170" r="150" fill="#e0a12e"/>
  <circle class="c" cx="270" cy="274" r="150" fill="#4a63d9"/>
  <g clip-path="url(#g)"><g clip-path="url(#a)"><circle cx="270" cy="274" r="150" fill="#0b7a5c"/></g></g>
  <rect x="176" y="196" width="188" height="48" rx="24" fill="#16181a"/><circle cx="206" cy="220" r="7" fill="#0b7a5c"/>
  <text x="224" y="227" font-size="19" font-weight="600" fill="#faf8f4" font-family="system-ui, sans-serif">Tue · 3:00 PM</text>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname });
await browser.close();
console.log('wrote public/og.png');
