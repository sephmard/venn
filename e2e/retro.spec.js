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

test('the app keeps its own look, retro mode or not', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('venn:retro', '1'));
  await page.goto('/new');
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
});
