// Draws the example on the home page's "Make it yours": a poll's own picture, and the link-preview
// card Venn makes from it with a Finn sticker, with the same code the create page uses (public/poll-image.js):
// `npm run og:example`. Writes public/img/shots/preview-card.webp and preview-icon.webp.
// Needs Playwright's Chromium (`npx playwright install chromium`, or set CHROMIUM_PATH).

import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createApp } from '../server.js';

const TITLE = 'Cabin weekend';

// The organizer's "photo": a cabin by a lake at sunset, drawn here so the repo holds no one's picture.
const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffb37a"/><stop offset="0.55" stop-color="#ffd9a0"/><stop offset="1" stop-color="#fff1cf"/>
    </linearGradient>
    <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7fb3c8"/><stop offset="1" stop-color="#3f7590"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#sky)"/>
  <circle cx="330" cy="250" r="62" fill="#fff4d6" opacity="0.9"/>
  <path d="M0 300 L90 190 L170 280 L250 170 L360 290 L440 210 L512 270 L512 330 L0 330 Z" fill="#8a7fa8"/>
  <path d="M0 320 L120 240 L210 310 L300 230 L420 320 L512 280 L512 340 L0 340 Z" fill="#5e6f8a"/>
  <rect y="330" width="512" height="182" fill="url(#lake)"/>
  <ellipse cx="330" cy="352" rx="70" ry="6" fill="#fff4d6" opacity="0.55"/>
  <ellipse cx="330" cy="372" rx="44" ry="4" fill="#fff4d6" opacity="0.4"/>
  <g fill="#2f4a3a">
    <path d="M40 340 L62 250 L84 340 Z"/><path d="M70 345 L96 230 L122 345 Z"/>
    <path d="M430 345 L452 260 L474 345 Z"/><path d="M462 345 L486 240 L510 345 Z"/>
  </g>
  <g transform="translate(150 262)">
    <path d="M0 40 L60 0 L120 40 Z" fill="#7a3b22"/>
    <rect x="12" y="40" width="96" height="48" fill="#a8613a"/>
    <rect x="50" y="56" width="20" height="32" fill="#4a2a1a"/>
    <rect x="22" y="52" width="18" height="16" fill="#ffd27a"/><rect x="80" y="52" width="18" height="16" fill="#ffd27a"/>
    <rect x="88" y="10" width="12" height="24" fill="#5a2f1c"/>
  </g>
  <rect x="140" y="348" width="140" height="4" rx="2" fill="#2f4a3a" opacity="0.35"/>
</svg>`;

const app = createApp({ env: {} });
await new Promise((r) => app.listen(0, r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${app.address().port}/privacy`);
  const { card, icon } = await page.evaluate(
    async ({ svg, title }) => {
      const { layoutPreview, drawPreview, CARD } = await import('/poll-image.js');
      const { loadFonts } = await import('/share-card.js');
      const { makeSticker } = await import('/finn-stickers.js');
      const { STICKERS } = await import('/finn-moments.js');
      const sticker = await createImageBitmap(await makeSticker(STICKERS.find((x) => x.key === 'cant-wait')));
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await Promise.all([img.decode(), loadFonts()]);
      const picture = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
      picture.getContext('2d').drawImage(img, 0, 0, 512, 512);
      const c = Object.assign(document.createElement('canvas'), CARD);
      const ctx = c.getContext('2d');
      const measure = (t, font) => ((ctx.font = font), ctx.measureText(t).width);
      drawPreview(ctx, layoutPreview(measure, title), picture, sticker);
      const small = Object.assign(document.createElement('canvas'), { width: 192, height: 192 });
      small.getContext('2d').drawImage(picture, 0, 0, 192, 192);
      return { card: c.toDataURL('image/webp', 0.82), icon: small.toDataURL('image/webp', 0.85) };
    },
    { svg: PHOTO, title: TITLE },
  );
  for (const [name, url] of [
    ['preview-card', card],
    ['preview-icon', icon],
  ]) {
    const file = new URL(`../public/img/shots/${name}.webp`, import.meta.url);
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`wrote public/img/shots/${name}.webp`);
  }
} finally {
  await browser.close();
  app.close();
}
