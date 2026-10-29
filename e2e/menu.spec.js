import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 740 } });

for (const path of ['/', '/privacy', '/templates/book-club']) {
  test(`the phone menu closes on a tap outside it, Escape, or one of its links: ${path}`, async ({ page }) => {
    await page.goto(path);
    const menu = page.locator('details.menu');
    const toggle = page.getByLabel('Menu');
    const panel = menu.locator('.menu-panel');

    await toggle.click();
    await expect(panel).toBeVisible();
    // A tap inside the panel (not on a link) leaves it open.
    await panel.click({ position: { x: 4, y: 4 } });
    await expect(panel).toBeVisible();
    await page.locator('main').click({ position: { x: 10, y: 300 } });
    await expect(panel).toBeHidden();

    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();

    // The toggle still closes it too.
    await toggle.click();
    await toggle.click();
    await expect(panel).toBeHidden();
  });
}

test('picking a link on the same page closes the menu', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Menu').click();
  await page.locator('.menu-panel').getByRole('link', { name: 'Contact' }).click();
  await expect(page.getByRole('dialog', { name: 'Ideas and questions' })).toBeVisible();
  await expect(page.locator('.menu-panel')).toBeHidden();
});
