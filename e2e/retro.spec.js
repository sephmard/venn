import { test, expect } from '@playwright/test';

// The website's retro mode: the site's own look, a switch in the menu to the classic look,
// remembered in this browser.

test(
  'retro mode is the default; the menu switches the site to the classic look and back, and it is remembered',
  { tag: '@site' },
  async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const sticker = page.locator('[data-stickers] img').first();
    await expect(html).toHaveClass(/\bretro\b/);
    await expect(page.locator('.brand .logo-retro')).toBeVisible();
    await expect(page.locator('.brand .logo-classic')).toBeHidden();
    await expect(sticker).toHaveAttribute('src', /\/stickers\/retro\/finn-/);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', /logo-retro\.svg/);
    await expect(page).toHaveURL(/\/$/); // nothing to add to the address: the link is retro as it is

    await page.getByLabel('Menu').click();
    const toggle = page.getByRole('switch', { name: 'Retro mode' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(html).not.toHaveClass(/\bretro\b/);
    await expect(page.locator('.brand .logo-classic')).toBeVisible();
    await expect(page.locator('.brand .logo-retro')).toBeHidden();
    await expect(sticker).toHaveAttribute('src', /\/stickers\/finn-/);

    // Remembered: other pages and the next visit open in the classic look.
    await page.goto('/privacy');
    await expect(html).not.toHaveClass(/\bretro\b/);
    await page.getByLabel('Menu').click();
    await page.getByRole('switch', { name: 'Retro mode' }).click();
    await expect(html).toHaveClass(/\bretro\b/);
    await page.goto('/');
    await expect(html).toHaveClass(/\bretro\b/);
    await expect(sticker).toHaveAttribute('src', /\/stickers\/retro\/finn-/);
  },
);

test(
  'a link shares the look: the classic look puts ?retro=0 in the address, and ?retro=1 turns retro back on',
  { tag: '@site' },
  async ({ page }) => {
    await page.goto('/?retro=0');
    await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
    await page.goto('/privacy');
    await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
    await expect(page).toHaveURL(/\?retro=0$/); // remembered, and in the address to copy
    await page.getByLabel('Menu').click();
    await page.getByRole('switch', { name: 'Retro mode' }).click();
    await expect(page).not.toHaveURL(/retro=/);
    await page.goto('/?retro=0');
    await page.goto('/?retro=1');
    await expect(page.locator('html')).toHaveClass(/\bretro\b/);
    await expect(page).not.toHaveURL(/retro=/);
  },
);

test('a new poll starts in the usual look; the organizer picks the retro look, shown as it is made', async ({ page }) => {
  await page.goto('/');
  await page.goto('/new');
  const look = page.getByRole('switch', { name: 'Retro look' });
  await expect(look).not.toBeChecked();
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  await look.check();
  await expect(page.locator('html')).toHaveClass(/\bretro\b/);
  await look.uncheck();
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  // A link to a new poll can still ask for it.
  await page.goto('/new?retro=1');
  await expect(page.getByRole('switch', { name: 'Retro look' })).toBeChecked();
});
