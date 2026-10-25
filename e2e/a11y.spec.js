import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Automated accessibility checks (WCAG 2.2 A/AA rules from axe) on every main screen, in light and
// dark mode, on desktop and phone. Serious and critical problems fail the build.
async function audit(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = blocking
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
    .join('\n');
  expect(blocking, `${label}\n${report}`).toEqual([]);
}

for (const scheme of ['light', 'dark']) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test('create page', async ({ page }) => {
      await page.goto('/');
      await page.click('#weekdays');
      const day = await page.locator('[data-add]').first().getAttribute('data-add');
      await page.click(`[data-add="${day}"]`);
      await audit(page, 'create page');
    });

    test('answering and results, as organizer', async ({ page }) => {
      page.on('dialog', (d) => d.accept());
      await page.goto('/');
      await page.fill('#title', 'Accessibility check');
      await page.click('#weekdays');
      const day = await page.locator('[data-add]').first().getAttribute('data-add');
      await page.click(`[data-add="${day}"]`);
      await page.click(`[data-add="${day}"]`);
      await page.click('#submit');
      await page.locator('.opt').first().locator('[data-vote="2"]').click();
      await page.fill('#name', 'Sam');
      await page.click('#save');
      await expect(page.locator('.matrix')).toBeVisible();
      await page.locator('.best [data-pick]').first().click();
      await expect(page.locator('.banner-final')).toBeVisible();
      await page.click('#notify-open');
      await expect(page.locator('#notify-form')).toBeVisible();
      await audit(page, 'event page (organizer)');
    });

    test('open time range grid', async ({ page }) => {
      await page.goto('/');
      await page.fill('#title', 'Grid check');
      await page.click('[data-mode="grid"]');
      await page.click('#weekdays');
      await page.click('#submit');
      await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();
      await audit(page, 'grid poll');
    });
  });
}
