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

    test('landing and privacy pages', async ({ page }) => {
      await page.goto('/');
      await audit(page, 'landing page');
      await page.goto('/privacy');
      await audit(page, 'privacy page');
    });

    test('create pages', async ({ page }) => {
      await page.goto('/new');
      await audit(page, 'chooser');
      await page.goto('/new/pick');
      await page.click('[data-occasion="0"]');
      await page.click('#q-week');
      await page.click('#times [data-time="1140"]');
      await audit(page, 'vote on a few dates');
      await page.goto('/new/free');
      await page.click('#q-2w');
      await page.click('[data-mark="hours"]');
      await audit(page, 'ask when people are free');
    });

    test('answering and results, as organizer', async ({ page }) => {
      page.on('dialog', (d) => d.accept());
      await page.goto('/new/pick');
      await page.fill('#title', 'Accessibility check');
      await page.click('#q-week');
      await page.click('#times [data-time="600"]');
      await page.click('#submit');
      await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
      await page.locator('#mine .row').nth(1).locator('[data-vote="1"]').click();
      await audit(page, 'event page (answering)');
      await page.fill('#name', 'Sam');
      await page.click('#save');
      await expect(page.locator('.matrix')).toBeVisible();
      await page.locator('.best-hero [data-pick]').click();
      await expect(page.locator('.banner-final')).toBeVisible();
      await page.click('#notify-open');
      await expect(page.locator('#notify-form')).toBeVisible();
      await audit(page, 'event page (organizer)');
    });

    test('days and hours polls', async ({ page }) => {
      await page.goto('/new/free');
      await page.fill('#title', 'Days check');
      await page.click('#q-2w');
      await page.click('#submit');
      await expect(page.locator('#mine .row').first()).toBeVisible();
      await audit(page, 'days poll');
      await page.goto('/new/free');
      await page.fill('#title', 'Grid check');
      await page.click('#q-2w');
      await page.click('[data-mark="hours"]');
      await page.click('#submit');
      await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();
      await audit(page, 'hours poll');
    });
  });
}
