import { test, expect } from '@playwright/test';
import { addOptions } from './helpers.js';
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
      await addOptions(page, 2);
      await audit(page, 'vote on a few dates (week or day)');
      await page.click('[data-length="days"]');
      await page.click('[data-nav="1"]');
      await page.locator('.cal-day').first().click();
      await page.locator('.cal-grid').evaluate((el) => el.scrollIntoView({ block: 'center' })); // clear of the sticky bar
      await audit(page, 'vote on a few dates (trips)');
      await page.goto('/new/free');
      await page.click('#q-2w');
      await audit(page, 'ask when people are free (whole days)');
      await page.click('[data-level="parts"]');
      await audit(page, 'ask when people are free (parts of the day)');
      await page.click('[data-level="hours"]');
      await audit(page, 'ask when people are free (painting hours)');
    });

    test('privacy options, the Privacy panel, and a guest with answers hidden', async ({ page, browser }) => {
      await page.goto('/new/free');
      await page.fill('#title', 'Privacy check'); // whole days is where it starts
      await page.click('#q-2w');
      await page.locator('#privacy-opts summary').click();
      for (const name of ['Ask everyone for their email', "Hide everyone's answers from guests"])
        await page.getByRole('switch', { name }).check();
      await audit(page, 'create (privacy options)');
      await page.click('#submit');
      await page.getByRole('button', { name: 'View poll' }).click();
      await expect(page.locator('details.organizer')).toBeVisible();
      if (!(await page.locator('#privacy-open').isVisible())) await page.locator('details.organizer summary').click();
      await page.click('#privacy-open');
      await expect(page.locator('#privacy-form')).toBeVisible();
      await audit(page, 'organizer privacy panel');
      const guest = await browser.newContext({ colorScheme: scheme });
      const g = await guest.newPage();
      await g.goto(page.url());
      await expect(g.locator('#copy-to')).toBeVisible();
      await audit(g, 'guest, with email asked for and answers hidden');
      await guest.close();
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
      await addOptions(page, 2);
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
      test.setTimeout(60_000); // three polls, each with its celebration, and five scans
      page.on('dialog', (d) => d.accept()); // leaving a poll with unsaved answers asks first
      await page.goto('/new/free');
      await page.fill('#title', 'Days check');
      await page.click('#q-2w');
      await page.click('#submit');
      await expect(page.locator('#mine .row').first()).toBeVisible();
      await audit(page, 'days poll');
      await page.goto('/new/free');
      await page.fill('#title', 'Grid check');
      await page.click('[data-level="hours"]');
      await page.click('[data-fill="3"]');
      await page.click('#submit');
      await expect(page.locator('#quick-hours .part-vote').first()).toBeVisible({ timeout: 10_000 }); // after the celebration
      await page.locator('#quick-hours .part-vote').first().click();
      await audit(page, 'hours poll (quick answers)');
      await page.click('[data-hview="exact"]');
      await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();
      await audit(page, 'hours poll (exact times)');
      // Older polls ask about mornings, afternoons and evenings.
      const day = (d, h) => Date.UTC(2030, 0, d, h);
      const options = [8, 9].flatMap((d) => [
        { start: day(d, 12), end: day(d, 17) },
        { start: day(d, 18), end: day(d, 22) },
      ]);
      const res = await page.request.post('/api/events', {
        data: { title: 'Parts check', timezone: 'UTC', mode: 'options', layout: 'parts', options },
      });
      await page.goto(`/e/${(await res.json()).id}`);
      await page.locator('.part-vote').first().click();
      await page.fill('#name', 'Sam');
      await page.click('#save');
      await page.locator('.heat-btn').first().click();
      await audit(page, 'parts of the day poll');
    });
  });
}
