import { test, expect } from '@playwright/test';

// The website's look: retro is its own; Classic mode in the footer, or venn.day/classic, switches to
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
    // Venn's logo in the page itself, for search results, chat apps and browsers that take the .ico.
    const served = await (await page.request.get('/')).text();
    expect(served).toContain('<link rel="icon" href="/logo-retro.ico?v=1" sizes="32x32" />');
    expect(served).toContain('<link rel="icon" href="/logo-retro.svg?v=1" type="image/svg+xml" />');
    await expect(page.locator('link[rel="icon"][sizes]')).toHaveAttribute('href', /logo-retro\.ico/);
    await expect(page).toHaveURL(/\/$/);

    // In the footer, not the menu.
    await page.getByLabel('Menu').click();
    await expect(page.locator('.menu-panel').getByRole('switch')).toHaveCount(0);
    await page.getByLabel('Menu').click();
    const toggle = page.locator('footer').getByRole('switch', { name: 'Classic mode' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(html).not.toHaveClass(/\bretro\b/);
    // The neon logo stays, in either look.
    await expect(page.locator('.brand .logo-retro')).toBeVisible();
    await expect(page.locator('.brand .logo-classic')).toBeHidden();
    await expect(sticker).toHaveAttribute('src', /\/stickers\/finn-/);
    // Classic mode's tab icon is the green one, .ico too.
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', /favicon\.svg/);
    await expect(page.locator('link[rel="icon"][sizes]')).toHaveAttribute('href', /favicon\.ico/);
    await expect(page).toHaveURL(/\/classic$/); // the address to copy shares the classic look

    // Remembered: other pages, and the logo's link home, stay classic.
    await page.goto('/privacy');
    await expect(html).not.toHaveClass(/\bretro\b/);
    await page.goto('/');
    await expect(html).not.toHaveClass(/\bretro\b/);
    await expect(page).toHaveURL(/\/classic$/);
    await page.locator('footer').getByRole('switch', { name: 'Classic mode' }).click();
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

test('a new poll is in the page’s look: retro like the site, or classic from the footer’s Classic mode', async ({ page }) => {
  await page.goto('/new');
  // No look switch on the form: the footer has Classic mode, as on the website.
  await expect(page.getByRole('switch', { name: 'Retro look' })).toHaveCount(0);
  const classic = page.locator('.footer').getByRole('switch', { name: 'Classic mode' });
  await expect(classic).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('html')).toHaveClass(/\bretro\b/);
  await classic.click();
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  await expect(classic).toHaveAttribute('aria-checked', 'true');
  // Remembered, like the website's: the site is classic now too.
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  await page.goto('/new');
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  await classic.click();
  await expect(page.locator('html')).toHaveClass(/\bretro\b/);
  // Someone who chose the site's classic look starts new polls in it too.
  await page.goto('/classic');
  await page.goto('/new');
  await expect(classic).toHaveAttribute('aria-checked', 'true');
  // The switch is for a new poll's page only.
  await page.goto('/me');
  await expect(page.locator('.footer .classic-switch')).toBeHidden();
});
