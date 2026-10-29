// Renders the Finn stickers to small pictures the site and the poll page show, a few at a time:
// `npm run stickers`. Writes public/img/stickers/finn-<key>.webp (256×256) for the poll page, and
// public/img/stickers/retro/finn-<key>.webp in the website's retrofuturist look, drawn by the same
// code as the stickers themselves (public/finn-stickers.js), so they never drift apart.
// Needs Playwright's Chromium (`npx playwright install chromium`, or set CHROMIUM_PATH).

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createApp } from '../server.js';

const SIZE = 256;
const out = new URL('../public/img/stickers/', import.meta.url);
mkdirSync(new URL('retro/', out), { recursive: true });

const app = createApp({ env: {}, dbPath: ':memory:' });
await new Promise((r) => app.listen(0, r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${app.address().port}/new`);
  const pictures = await page.evaluate(async (size) => {
    const [{ makeSticker }, { STICKERS }] = await Promise.all([import('/finn-stickers.js'), import('/finn-moments.js')]);
    const done = [];
    for (const retro of [false, true])
      for (const s of STICKERS) {
        const bitmap = await createImageBitmap(await makeSticker(s, { retro }));
        const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, size, size);
        done.push([`${retro ? 'retro/' : ''}finn-${s.key}`, c.toDataURL('image/webp', 0.86).split(',')[1]]);
      }
    return done;
  }, SIZE);
  for (const [name, b64] of pictures) {
    writeFileSync(new URL(`${name}.webp`, out), Buffer.from(b64, 'base64'));
    console.log(`wrote public/img/stickers/${name}.webp`);
  }
} finally {
  await browser.close();
  app.close();
}
