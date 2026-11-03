import { test, expect } from '@playwright/test';

// Date or Vote on Create a Venn when the next form's code can't load (a flaky phone): the switch and
// the form come back, and the page says what happened. (Its taps while loading: drafts.spec.js.)

test('if the Vote form can’t load, the date form comes back and says so', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#title', 'Cabin plans');
  await page.route('**/create-topic.js', (r) => r.abort());
  await page.click('.kind-switch a[href^="/new/topic"]');
  await expect(page.locator('#switch-err')).toHaveText("Couldn't open the Vote form. Check your connection and try again.");
  // The switch is back on Date, the form is usable again, and it's at its own address.
  await expect(page.locator('.kind-switch a[href="/new"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.kind-switch a[href^="/new/topic"]')).not.toHaveAttribute('aria-current', 'page');
  const form = page.locator('#create');
  await expect(form).not.toHaveAttribute('aria-busy', 'true');
  expect(await form.evaluate((f) => f.inert)).toBe(false);
  await expect(page).toHaveURL(/\/new$/);
  await expect(form).toHaveCSS('opacity', '1');
  await page.fill('#title', 'Cabin plans, again');
  await expect(page.locator('#title')).toHaveValue('Cabin plans, again');
  // What's typed now is still kept: it's there after a reload.
  await page.unroute('**/create-topic.js');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Cabin plans, again');
});
