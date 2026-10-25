// Renders the PNG app icons from public/icons/icon.svg: `npm run icons`.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${join(dir, 'icon.svg')}`);
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.evaluate((s) => {
    const svg = document.querySelector('svg');
    svg.setAttribute('width', s);
    svg.setAttribute('height', s);
  }, size);
  await page.screenshot({ path: join(dir, name), omitBackground: false });
}
await browser.close();
console.log('wrote public/icons/*.png');
