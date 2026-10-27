import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addOptions } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => {
    throw e;
  });
  // The app must work under its own Content Security Policy.
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) throw new Error(msg.text());
  });
});

/** A 900 × 600 PNG, drawn in the browser: a wide picture, so it has to be cropped to a square. */
const fixture = (page) =>
  page.evaluate(() => {
    const c = Object.assign(document.createElement('canvas'), { width: 900, height: 600 });
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e0a12e';
    ctx.fillRect(0, 0, 900, 600);
    ctx.fillStyle = '#0b7a5c';
    ctx.beginPath();
    ctx.arc(450, 300, 220, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL('image/png').split(',')[1];
  });

/** JPEG width and height, from its start-of-frame marker. */
function jpegSize(buf) {
  for (let i = 2; i < buf.length;) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

test('organizers give a poll any emoji or their own picture, shown on the poll and in its link preview', async ({
  page,
  request,
}) => {
  await page.goto('/new/pick');
  await page.fill('#title', 'Cake tasting');
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 2);

  // The tile beside the name opens the icon panel.
  const tile = page.getByRole('button', { name: 'Change the icon' });
  await expect(tile).toHaveAttribute('aria-expanded', 'false');
  await tile.click();
  await expect(tile).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#icon-emoji')).toBeFocused();
  // Phones don't zoom into it.
  expect(await page.locator('#icon-emoji').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(
    16,
  );

  // Any emoji; words aren't one.
  await page.fill('#icon-emoji', 'cake');
  await expect(page.locator('#icon-err')).toContainText("isn't an emoji");
  await page.fill('#icon-emoji', '🎂 yum');
  await expect(page.locator('#icon-err')).toBeEmpty();
  await expect(tile).toHaveText('🎂');

  // A picture of their own, made square and small in the browser.
  const upload = page.getByRole('button', { name: 'Upload a picture' });
  const box = await upload.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await page.setInputFiles('#icon-file', {
    name: 'cake.png',
    mimeType: 'image/png',
    buffer: Buffer.from(await fixture(page), 'base64'),
  });
  await expect(tile.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(page.getByRole('button', { name: 'Remove picture' })).toBeVisible();
  // A picture or an emoji, not both: the picture replaces the emoji, and the emoji field steps aside.
  await expect(page.locator('#icon-emoji')).toBeHidden();
  await expect(page.locator('#icon-hint')).toHaveText('Your picture is the icon. Remove it to use an emoji instead.');
  // The link preview, as people will see it: Finn's on it, unless they'd rather not.
  const finn = page.getByRole('group', { name: 'Finn on your link preview' });
  await expect(finn.getByRole('button', { name: 'Can’t wait' })).toHaveAttribute('aria-pressed', 'true');
  const preview = page.getByRole('img', { name: "How your poll's link looks when it's shared" });
  await expect(preview).toHaveAttribute('src', /^blob:/);
  const before = await preview.getAttribute('src');
  await finn.getByRole('button', { name: 'No Finn' }).click();
  await expect(finn.getByRole('button', { name: 'No Finn' })).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).not.toHaveAttribute('src', before);
  await finn.getByRole('button', { name: 'Can’t wait' }).click();
  await expect(finn.getByRole('button', { name: 'Can’t wait' })).toHaveAttribute('aria-pressed', 'true');
  await expect(preview).not.toHaveAttribute('src', before);
  await expect.poll(() => preview.evaluate((img) => img.naturalWidth)).toBe(1200);
  const scan = await new AxeBuilder({ page })
    .include('#icon-panel')
    .include('#emoji-tile')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(scan.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  // Escape closes the panel and goes back to the tile.
  await upload.press('Escape');
  await expect(page.locator('#icon-panel')).toHaveCount(0);
  await expect(tile).toBeFocused();

  await page.click('#submit');
  // The celebration shows the picture beside Finn.
  await expect(page.locator('.party .party-pic')).toBeVisible();
  await page.getByRole('button', { name: /^(View poll|Open .+ →)$/ }).click();
  await expect(page).toHaveURL(/\/e\/\w+$/);
  const id = page.url().split('/e/')[1];

  // The poll page shows it in place of the emoji.
  const head = page.locator('.poll-head .emoji-tile img');
  await expect(head).toHaveAttribute('src', new RegExp(`^/api/events/${id}/icon\\.jpg\\?v=\\d+$`));
  await expect.poll(() => head.evaluate((img) => img.naturalWidth)).toBe(512);

  const ev = await (await request.get(`/api/events/${id}`)).json();
  expect(ev.emoji).toBeUndefined();
  expect(ev.image).toEqual({ v: expect.any(Number), card: true, type: 'image/jpeg' });
  const icon = await request.get(`/api/events/${id}/icon.jpg?v=${ev.image.v}`);
  expect(icon.headers()['content-type']).toBe('image/jpeg');
  expect(jpegSize(await icon.body())).toEqual([512, 512]);
  const card = await request.get(`/api/events/${id}/card.jpg?v=${ev.image.v}`);
  expect(card.headers()['content-type']).toBe('image/jpeg');
  expect(card.headers()['x-content-type-options']).toBe('nosniff');
  const cardBytes = await card.body();
  expect(jpegSize(cardBytes)).toEqual([1200, 630]);
  expect(cardBytes.length).toBeLessThan(300_000);

  // Chat apps get the poll's own card.
  const html = await (await request.get(`/e/${id}`)).text();
  const ogImage = /<meta property="og:image" content="([^"]+)"/.exec(html)[1];
  expect(ogImage).toMatch(new RegExp(`/api/events/${id}/card\\.jpg\\?v=${ev.image.v}$`));
  expect(html).toContain('<meta property="og:title" content="Cake tasting" />');

  // Editing keeps the picture (with a new card for the new name), until it's removed.
  await page.goto(`/new/pick?edit=${id}`);
  await expect(page.locator('#emoji-tile img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.fill('#title', 'Cake tasting, take two');
  await page.click('#submit');
  await expect(page).toHaveURL(`/e/${id}`);
  const edited = await (await request.get(`/api/events/${id}`)).json();
  expect(edited.image.v).toBeGreaterThan(ev.image.v);
  expect(edited.emoji).toBeUndefined();

  await page.goto(`/new/pick?edit=${id}`);
  await page.getByRole('button', { name: 'Change the icon' }).click();
  await expect(page.locator('#icon-emoji')).toBeHidden();
  await page.getByRole('button', { name: 'Remove picture' }).click();
  // Without the picture, an emoji can be the icon again.
  await expect(page.locator('#icon-emoji')).toBeVisible();
  await expect(page.locator('#icon-emoji')).toBeFocused();
  await page.fill('#icon-emoji', '🎂');
  await expect(page.locator('#emoji-tile')).toHaveText('🎂');
  await page.click('#submit');
  await expect(page).toHaveURL(`/e/${id}`);
  await expect(page.locator('.poll-head .emoji-tile')).toHaveText('🎂');
  expect((await (await request.get(`/api/events/${id}`)).json()).image).toBeUndefined();
  expect((await request.get(`/api/events/${id}/icon.jpg`)).status()).toBe(404);
});
