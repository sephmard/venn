import { test, expect } from '@playwright/test';

// The date form's tap key keeps its small dots after a visit to the template builder, whose
// stylesheet stays loaded (its logo colours are 44px round swatches of their own).
test('tap key dots stay small after the template builder', async ({ page }) => {
  await page.goto('/brand/new');
  await expect(page.locator('#brand-form')).toBeVisible();
  // Back to Create a Venn without a page load, as the website's own links do.
  await page.evaluate(() => {
    const a = Object.assign(document.createElement('a'), { href: '/new' });
    a.dataset.link = '';
    document.body.append(a);
    a.click();
  });
  await expect(page).toHaveURL(/\/new$/);
  const dot = page.locator('.tap-key .swatch').first();
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  expect(box.width).toBeLessThanOrEqual(16);
  expect(box.height).toBeLessThanOrEqual(16);
});
