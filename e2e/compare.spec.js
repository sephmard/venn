import { test, expect } from '@playwright/test';

// The comparison pages on the website: they fit a 375px phone, the table never scrolls sideways,
// the questions open, and the big button starts a poll.

const noSideways = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

for (const [path, name] of [
  ['/compare/doodle-alternative', 'Doodle'],
  ['/compare/when2meet-alternative', 'When2meet'],
]) {
  test(`compare page ${path}: fits a small phone, with a table, questions and a button that starts a poll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    await expect(page.locator('h1')).toContainText(`A ${name} alternative`);
    await expect(page).toHaveTitle(new RegExp(`^A ${name} alternative`));
    await noSideways(page);
    // The table fits inside the page, with Venn and the other tool as columns.
    const table = page.getByRole('table', { name: `Venn compared with ${name}` });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Venn' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name })).toBeVisible();
    const box = await table.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await expect(page.getByText('Comparison as of October 2026')).toBeVisible();
    // The phone screen has loaded and fits.
    const shot = page.locator('.cmp-shot img');
    await expect(shot).toHaveJSProperty('complete', true);
    expect(await shot.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    // Buttons and links outside the text are big enough to tap.
    for (const link of await page.locator('.crumbs a, main .btn, .tpl-more a, .faq summary, .footer a').all())
      expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    // The questions open.
    await page.locator('.faq summary').first().click();
    await expect(page.locator('.faq details').first().locator('p')).toBeVisible();
    await noSideways(page);
    // The big button opens the create page.
    await page.locator('.tpl-hero a.btn-lg').click();
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.locator('a[href="/new/pick"]')).toBeVisible();
  });
}

test('the comparisons: from the home page footer, to each comparison, and back by the breadcrumb', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Compare' }).click();
  await expect(page).toHaveURL(/\/compare$/);
  await expect(page.locator('h1')).toBeVisible();
  await noSideways(page);
  await page.locator('a.tpl-card[href="/compare/when2meet-alternative"]').click();
  await expect(page.locator('h1')).toContainText('When2meet');
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Compare' }).click();
  await expect(page).toHaveURL(/\/compare$/);
  await page.locator('a.tpl-card[href="/compare/doodle-alternative"]').click();
  await expect(page.locator('h1')).toContainText('Doodle');
  await page.locator('.closing a.btn-lg').click();
  await expect(page).toHaveURL(/\/new$/);
});
