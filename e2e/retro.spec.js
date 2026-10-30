import { test, expect } from '@playwright/test';

// The website's retro mode: off by default, a switch in the menu, remembered in this browser.

test('retro mode: the menu switches the site to neon and back, and it is remembered', { tag: '@site' }, async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const sticker = page.locator('[data-stickers] img').first();
  await expect(html).not.toHaveClass(/\bretro\b/);
  await expect(page.locator('.brand .logo-classic')).toBeVisible();
  await expect(page.locator('.brand .logo-retro')).toBeHidden();
  await expect(sticker).toHaveAttribute('src', /\/stickers\/finn-/);

  await page.getByLabel('Menu').click();
  const toggle = page.getByRole('switch', { name: 'Retro mode' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(html).toHaveClass(/\bretro\b/);
  await expect(page.locator('.brand .logo-retro')).toBeVisible();
  await expect(page.locator('.brand .logo-classic')).toBeHidden();
  await expect(sticker).toHaveAttribute('src', /\/stickers\/retro\/finn-/);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', /logo-retro\.svg/);

  // Remembered: other pages and the next visit open in retro mode.
  await page.goto('/privacy');
  await expect(html).toHaveClass(/\bretro\b/);
  await page.getByLabel('Menu').click();
  await page.getByRole('switch', { name: 'Retro mode' }).click();
  await expect(html).not.toHaveClass(/\bretro\b/);
  await page.goto('/');
  await expect(html).not.toHaveClass(/\bretro\b/);
  await expect(sticker).toHaveAttribute('src', /\/stickers\/finn-/);
});

test(
  'a link shares retro mode: ?retro=1 turns it on, and the address carries it while it is on',
  { tag: '@site' },
  async ({ page }) => {
    await page.goto('/?retro=1');
    await expect(page.locator('html')).toHaveClass(/\bretro\b/);
    await page.goto('/privacy');
    await expect(page.locator('html')).toHaveClass(/\bretro\b/);
    await expect(page).toHaveURL(/\?retro=1$/); // remembered, and in the address to copy
    await page.getByLabel('Menu').click();
    await page.getByRole('switch', { name: 'Retro mode' }).click();
    await expect(page).not.toHaveURL(/retro=/);
    await page.goto('/?retro=0');
    await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  },
);

test('with the site in retro mode, a new poll starts with the retro look, shown as it is made', async ({ page }) => {
  await page.goto('/?retro=1');
  await page.goto('/new');
  const look = page.getByRole('switch', { name: 'Retro look' });
  await expect(look).toBeChecked();
  await expect(page.locator('html')).toHaveClass(/\bretro\b/);
  // Off: the create page goes back to its usual look at once.
  await look.uncheck();
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
});
