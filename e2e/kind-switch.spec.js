import { test, expect } from '@playwright/test';
import { nextMonth, addDays, tapDays, setLevel, tapAt } from './helpers.js';

// Date or Vote on Create a Venn when the next form's code can't load (a flaky phone): the form left
// is drawn again, working, and the page says what happened. (Its taps while loading: drafts.spec.js.)

test('if the Vote form can’t load, the date form comes back working and says so', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#title', 'Cabin plans');
  const first = await nextMonth(page);
  await tapDays(page, [first]);
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
  // What was there is back, and the calendar still takes taps.
  await expect(page.locator('#title')).toHaveValue('Cabin plans');
  const day = (d) => page.locator(`#when .cal-day[data-date="${d}"]`);
  await expect(day(first)).toHaveAttribute('aria-pressed', 'true');
  const next = addDays(first, 1);
  await tapDays(page, [next]);
  await expect(day(next)).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#title', 'Cabin plans, again');
  // What's done now is still kept: it's there after a reload.
  await page.unroute('**/create-topic.js');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Cabin plans, again');
  await expect(day(next)).toHaveAttribute('aria-pressed', 'true');
});

// The router unhooks the form it leaves before the next one's code arrives (the hours calendar's
// window listener, which a mouse tap there needs): the form that comes back is a new one.
test('after a Vote form that can’t load, times can still be drawn on hours', async ({ page }) => {
  await page.goto('/new');
  const first = await nextMonth(page);
  await setLevel(page, 'hours');
  await tapAt(page, first, 1140, '#when');
  const list = page.locator('#free-list');
  await expect(list).toContainText('7:00 – 7:30 PM');
  await page.route('**/create-topic.js', (r) => r.abort());
  await page.click('.kind-switch a[href^="/new/topic"]');
  await expect(page.locator('#switch-err')).toBeVisible();
  await expect(page.locator('[data-level="hours"]')).toHaveAttribute('aria-checked', 'true');
  await expect(list).toContainText('7:00 – 7:30 PM');
  await tapAt(page, first, 1260, '#when');
  await expect(list).toContainText('9:00 – 9:30 PM');
});

test('if the Date form can’t load, the vote form comes back working and says so', async ({ page }) => {
  await page.goto('/new/topic');
  await page.getByLabel('Your question').fill('Where to?');
  await page.getByLabel('Option 1', { exact: true }).fill('Cabin');
  await page.route('**/create-free.js', (r) => r.abort());
  await page.click('.kind-switch a[href="/new"]');
  await expect(page.locator('#switch-err')).toHaveText("Couldn't open the Date form. Check your connection and try again.");
  await expect(page.locator('.kind-switch a[href^="/new/topic"]')).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/\/new\/topic$/);
  expect(await page.locator('#create').evaluate((f) => f.inert)).toBe(false);
  await expect(page.getByLabel('Your question')).toHaveValue('Where to?');
  await expect(page.getByLabel('Option 1', { exact: true })).toHaveValue('Cabin');
  await page.getByLabel('Option 2', { exact: true }).fill('Beach');
  await expect(page.getByLabel('Option 2', { exact: true })).toHaveValue('Beach');
});

// Seph (2026-11-07): going between Date, Vote and RSVP, the switch and its line stay put, right
// under the heading; whatever differs (the Use AI box, the sections) comes after them.
test('the switch and its line stay in place on all three forms', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 }); // a short phone
  await page.goto('/new');
  const sw = page.locator('.kind-switch');
  const where = async () => [(await sw.boundingBox()).y, (await page.locator('#kind-note').boundingBox()).y];
  await expect(page.locator('#kind-note')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true); // nothing focused on arrival
  await expect(page.locator('#title')).toHaveAttribute('autocomplete', 'off'); // no contact AutoFill for a poll's name
  const first = await where();
  for (const [name, path] of [
    ['Vote', '/new/topic'],
    ['RSVP', '/new/rsvp'],
    ['Date', '/new'],
  ]) {
    await sw.getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('#create')).not.toHaveAttribute('aria-busy', 'true');
    expect(await where()).toEqual(first);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    // No field takes focus (on a phone that opens the keyboard): it stays on the switch.
    await expect(sw.getByRole('link', { name })).toBeFocused();
    const h1 = await page.locator('#create h1').boundingBox();
    expect(first[0] - (h1.y + h1.height)).toBeLessThan(24); // nothing between the heading and the switch
  }
});
