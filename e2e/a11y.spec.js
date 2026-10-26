import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Automated accessibility checks (WCAG 2.2 A/AA rules from axe) on every main screen, in light and
// dark mode, on desktop and phone. Serious and critical problems fail the build.
async function audit(page, label, { party = false } = {}) {
  // A passing toast can sit over the page for a moment; it isn't part of what's being checked.
  await page.evaluate(() => document.getElementById('toast')?.setAttribute('hidden', ''));
  // Nor is the "poll created" celebration while it fades away (it has its own audit).
  if (!party) await expect(page.locator('.party')).toHaveCount(0, { timeout: 10_000 });
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
      await page.click('#draft-cal [data-nav="1"]');
      await page.locator('#draft-cal .cal-day').first().click();
      await page.click('[data-time="1140"]');
      await page.click('#add-draft');
      await audit(page, 'vote on a few dates (days, then times)');
      await page.click('[data-pick-mode="calendar"]');
      await page.click('.tv-nav [data-step="1"]');
      const grid = await page.locator('.tg-scroll').boundingBox();
      await page.mouse.click(grid.x + grid.width / 2, grid.y + 40);
      await audit(page, 'vote on a few dates (week or day)');
      await page.click('[data-length="days"]');
      await page.click('[data-nav="1"]');
      await page.locator('.cal-day').first().click();
      await page.locator('.cal-grid').evaluate((el) => el.scrollIntoView({ block: 'center' })); // clear of the sticky bar
      await audit(page, 'vote on a few dates (trips)');
      await page.goto('/new/free');
      await page.click('#q-2w');
      await page.click('[data-mark="hours"]');
      await page.click('[data-window="custom"]');
      await audit(page, 'ask when people are free');
    });

    test('the poll created celebration', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' }); // no confetti over the text
      await page.goto('/new/free');
      await page.fill('#title', 'Celebration check');
      await page.click('#q-2w');
      await page.click('#submit');
      await expect(page.locator('.party [role=status]')).toContainText('Poll created!');
      await audit(page, 'poll created', { party: true });
    });

    test('answering and results, as organizer', async ({ page }) => {
      page.on('dialog', (d) => d.accept());
      await page.goto('/new/pick');
      await page.fill('#title', 'Accessibility check');
      await page.click('#draft-cal [data-nav="1"]');
      for (const i of [0, 1]) await page.locator('#draft-cal .cal-day').nth(i).click();
      await page.click('[data-time="1140"]');
      await page.click('#add-draft');
      await page.click('#submit');
      await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
      await page.locator('#mine .row').nth(1).locator('[data-vote="1"]').click();
      await audit(page, 'event page (answering)');
      await page.click('[data-mine-view="calendar"]');
      await page.locator('.tg-block').first().click();
      await audit(page, 'event page (answering on the calendar)');
      await page.click('[data-mine-view="list"]');
      await page.fill('#name', 'Sam');
      await page.click('#save');
      await expect(page.locator('.matrix')).toBeVisible();
      await page.locator('.best-hero [data-pick]').click();
      await expect(page.locator('.banner-final')).toBeVisible();
      await page.click('#notify-open');
      await expect(page.locator('#notify-form')).toBeVisible();
      await page.locator('.dev summary').click();
      await audit(page, 'event page (organizer)');
    });

    test('days and hours polls', async ({ page }) => {
      await page.goto('/new/free');
      await page.fill('#title', 'Days check');
      await page.click('#q-2w');
      await page.click('[data-mark="days"]');
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
      await page.goto('/new/free');
      await page.fill('#title', 'Parts check');
      await page.click('#q-2w');
      await page.click('#submit');
      await page.locator('.part-vote').first().click();
      await page.fill('#name', 'Sam');
      await page.click('#save');
      await page.locator('.heat-btn').first().click();
      await audit(page, 'parts of the day poll');
    });
  });
}
