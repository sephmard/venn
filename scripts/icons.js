// Renders the icons: `npm run icons`.
// - public/icons/*.png from public/icons/icon.svg (app and home-screen icons)
// - public/favicon.ico from public/favicon.svg (16, 32 and 48 px, for browsers that ask for it)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const browser = await chromium.launch();

async function render(svgFile, size) {
  const uri = `data:image/svg+xml;base64,${readFileSync(svgFile).toString('base64')}`;
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0"><img src="${uri}" width="${size}" height="${size}" style="display:block">`);
  const png = await page.screenshot({ omitBackground: true });
  await page.close();
  return png;
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(pub, 'icons', name), await render(join(pub, 'icons', 'icon.svg'), size));
}

// An .ico file is a small header and directory followed by the images; modern ones hold PNGs.
const sizes = [16, 32, 48];
const pngs = [];
for (const size of sizes) pngs.push(await render(join(pub, 'favicon.svg'), size));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry); // width
  header.writeUInt8(size, entry + 1); // height
  header.writeUInt16LE(1, entry + 4); // colour planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(pngs[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += pngs[i].length;
});
writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([header, ...pngs]));

await browser.close();
console.log('wrote public/icons/*.png and public/favicon.ico');
