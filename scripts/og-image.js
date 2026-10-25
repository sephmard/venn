// Renders the social preview image, public/og.png (1200×630): `npm run og`.
// Needs Playwright's Chromium (`npx playwright install chromium`).

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const shot = readFileSync(new URL('../public/img/results-light.webp', import.meta.url)).toString('base64');

const html = `<!doctype html>
<style>
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #f7f7f5; color: #1c1d1f;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .text { position: absolute; left: 72px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 34px; font-weight: 700; margin-bottom: 36px; }
  h1 { font-size: 58px; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 22px; }
  p { font-size: 25px; line-height: 1.4; color: #6b6d70; margin: 0; }
  img { position: absolute; left: 600px; top: 64px; width: 760px; border-radius: 18px; border: 1px solid #e2e2dc;
    box-shadow: 0 30px 80px rgba(0,0,0,.14); }
</style>
<div class="text">
  <div class="brand">
    <svg viewBox="0 0 120 80" width="60" height="40"><defs><clipPath id="l"><circle cx="45" cy="40" r="30"/></clipPath></defs>
      <circle cx="45" cy="40" r="30" fill="#0f9d76" fill-opacity=".28"/><circle cx="75" cy="40" r="30" fill="#0f9d76" fill-opacity=".28"/>
      <circle cx="75" cy="40" r="30" fill="#0f9d76" clip-path="url(#l)"/></svg>
    Venn
  </div>
  <h1>Find a time that works for everyone</h1>
  <p>Free scheduling polls.<br>No sign-up, no ads.</p>
</div>
<img src="data:image/webp;base64,${shot}">`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname });
await browser.close();
console.log('wrote public/og.png');
