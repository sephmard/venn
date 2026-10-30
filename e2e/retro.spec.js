import { test, expect } from '@playwright/test';

// The website's look: retro is its own; Classic mode in the menu, or venn.day/classic, switches to
// the classic look, remembered in this browser. The home page's address always says which.

test(
  'retro is the default; Classic mode switches the site to the classic look and back, and it is remembered',
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
    await expect(page).toHaveURL(/\/$/);

    await page.getByLabel('Menu').click();
    const toggle = page.getByRole('switch', { name: 'Classic mode' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(html).not.toHaveClass(/\bretro\b/);
    await expect(page.locator('.brand .logo-classic')).toBeVisible();
    await expect(page.locator('.brand .logo-retro')).toBeHidden();
    await expect(sticker).toHaveAttribute('src', /\/stickers\/finn-/);
    await expect(page).toHaveURL(/\/classic$/); // the address to copy shares the classic look

    // Remembered: other pages, and the logo's link home, stay classic.
    await page.goto('/privacy');
    await expect(html).not.toHaveClass(/\bretro\b/);
    await page.goto('/');
    await expect(html).not.toHaveClass(/\bretro\b/);
    await expect(page).toHaveURL(/\/classic$/);
    await page.getByLabel('Menu').click();
    await page.getByRole('switch', { name: 'Classic mode' }).click();
    await expect(html).toHaveClass(/\bretro\b/);
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/privacy');
    await expect(html).toHaveClass(/\bretro\b/);
  },
);

test('venn.day/classic opens the classic look, and older ?retro= links still work', { tag: '@site' }, async ({ page }) => {
  await page.goto('/classic');
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  await expect(page.locator('h1')).toBeVisible();
  await page.goto('/?retro=1');
  await expect(page.locator('html')).toHaveClass(/\bretro\b/);
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/?retro=0');
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  await expect(page).toHaveURL(/\/classic$/);
});

test('a new poll starts in the retro look, like the site; the organizer can switch it off', async ({ page }) => {
  await page.goto('/new');
  const look = page.getByRole('switch', { name: 'Retro look' });
  await expect(look).toBeChecked();
  await expect(page.locator('html')).toHaveClass(/\bretro\b/);
  await look.uncheck();
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  // Someone who chose the site's classic look starts new polls in it too.
  await page.goto('/classic');
  await page.goto('/new');
  await expect(page.getByRole('switch', { name: 'Retro look' })).not.toBeChecked();
});
