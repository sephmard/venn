// "Vote on a few dates" fetches its week and day calendar (time-view.js) after the page: on a slow
// connection the calendar still comes and works, and a failed fetch says so and can be tried again.
import { test, expect } from '@playwright/test';
import { addOptions } from './helpers.js';

test('vote on a few dates: a slow calendar still shows and takes options', async ({ page }) => {
  await page.route('**/time-view.js', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto('/new/pick');
  await expect(page.locator('#picker .tv-bar')).toBeVisible();
  await addOptions(page, 1);
  await expect(page.locator('#summary')).toHaveText('1 option to vote on');
});

test('vote on a few dates: a calendar that fails to load says so, and Try again brings it', async ({ page }) => {
  await page.route('**/time-view.js', (route) => route.abort());
  await page.goto('/new/pick');
  await expect(page.locator('#picker [role=alert]')).toHaveText(/Couldn't load the calendar/);
  await page.unroute('**/time-view.js');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('#picker .tv-bar')).toBeVisible();
  await addOptions(page, 1);
  await expect(page.locator('#summary')).toHaveText('1 option to vote on');
});
