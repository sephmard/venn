import { test, expect } from '@playwright/test';
import { addOptions, mockPlaces } from './helpers.js';

// Address search in "Where" (public/place-search.js). The test server has it switched off, so each
// test switches it on in /api/config and answers /api/places itself: no real provider is called.

const opts = (page) => page.getByRole('listbox', { name: 'Suggested places' }).getByRole('option');
const where = (page) => page.getByRole('combobox', { name: 'Where' });

async function openWhere(page) {
  await page.click('#more-box summary');
  await page.locator('#location').focus();
  await expect(where(page)).toBeVisible(); // place-search.js has loaded
}

test('Where suggests places as you type; arrow keys and Enter pick one', async ({ page }) => {
  const searches = await mockPlaces(page);
  await page.goto('/new/pick');
  await openWhere(page);
  const box = where(page);
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.type('ro');
  await page.waitForTimeout(400);
  expect(searches).toHaveLength(0); // not before three letters
  await page.keyboard.type('sa');
  const list = page.getByRole('listbox', { name: 'Suggested places' });
  await expect(list.getByRole('option')).toHaveCount(3);
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  expect(searches).toHaveLength(1); // one search after the pause, not one per letter
  expect(searches[0].q).toBe('rosa');
  expect(searches[0].session).toBeUndefined(); // only Google uses session tokens
  // The name stands out, the rest is quieter; OpenStreetMap is credited.
  await expect(list.getByRole('option').first().locator('strong')).toHaveText("Rosa's Pizza");
  await expect(page.getByRole('link', { name: '© OpenStreetMap' })).toBeVisible();
  // Big enough to tap.
  expect((await list.getByRole('option').first().boundingBox()).height).toBeGreaterThanOrEqual(44);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(box).toHaveAttribute('aria-activedescendant', 'ps-opt-1');
  await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); // wraps round to the last
  await expect(box).toHaveAttribute('aria-activedescendant', 'ps-opt-2');
  await page.keyboard.press('ArrowDown'); // and back to the first
  await page.keyboard.press('Enter');
  await expect(box).toHaveValue("Rosa's Pizza, 374 Metropolitan Avenue, New York");
  await expect(list).toBeHidden();
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await expect(box).toBeFocused();

  // Escape closes the suggestions and keeps what was typed.
  await box.fill('');
  await page.keyboard.type('Rosario');
  await expect(list.getByRole('option')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(box).toHaveValue('Rosario');

  // The place picked is the poll's.
  await page.fill('#title', 'Dinner');
  await page.fill('#organizer', 'Sam');
  await box.fill('');
  await box.pressSequentially('Rosa');
  await opts(page).filter({ hasText: "Rosa's Cantina" }).click();
  await expect(box).toHaveValue("Rosa's Cantina, Mission Street 12, San Francisco");
  await addOptions(page, 1);
  await page.click('#submit');
  await expect(page.locator('.where a')).toHaveText("Rosa's Cantina, Mission Street 12, San Francisco");
  await expect(page.locator('.where a')).toHaveAttribute('href', /google\.com\/maps\/search\/.*Rosa/);
});

test('Where: a tap picks a place, and on a phone the suggestions fit', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await mockPlaces(page);
  await page.goto('/new/free');
  await openWhere(page);
  await page.keyboard.type('Rosa');
  const option = opts(page).filter({ hasText: 'Rosario' });
  if (testInfo.project.use.hasTouch) await option.tap();
  else await option.click();
  await expect(where(page)).toHaveValue('Rosario, Argentina');
  await expect(where(page)).toBeFocused();
  // No sideways scrolling with the suggestions open, and they stay inside the screen.
  await where(page).fill('');
  await page.keyboard.type('Rosas');
  await expect(opts(page)).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  const pop = await page.locator('.ps-pop').boundingBox();
  expect(pop.x).toBeGreaterThanOrEqual(0);
  expect(pop.x + pop.width).toBeLessThanOrEqual(375);
  // A tap somewhere else closes them, keeping what was typed.
  await page.click('#title');
  await expect(page.locator('.ps-pop')).toBeHidden();
  await expect(where(page)).toHaveValue('Rosas');
});

test('Where: video links are never searched, and no matches keeps what you typed', async ({ page }) => {
  const searches = await mockPlaces(page);
  await page.goto('/new/pick');
  await openWhere(page);
  for (const link of ['https://zoom.us/j/123456', 'meet.google.com/abc-defg-hij']) {
    await where(page).fill('');
    await page.keyboard.type(link);
  }
  await page.waitForTimeout(500);
  expect(searches).toHaveLength(0);
  await expect(page.locator('.ps-pop')).toBeHidden();

  await where(page).fill('');
  await page.keyboard.type("Grandma's back garden");
  await expect(page.getByText("No matches. We'll use what you typed.")).toBeVisible();
  await expect(opts(page)).toHaveCount(0);
  await expect(where(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(where(page)).toHaveValue("Grandma's back garden");
});

test('Where: when place search fails, nothing is shown', async ({ page }) => {
  await mockPlaces(page);
  await page.route('**/api/places?*', (route) => route.fulfill({ status: 502, json: { error: 'down' } }));
  await page.goto('/new/pick');
  await openWhere(page);
  await page.keyboard.type('Rosa');
  await page.waitForTimeout(700);
  await expect(page.locator('.ps-pop')).toBeHidden();
  await expect(where(page)).toHaveValue('Rosa');
});

test('Where with Google: its attribution, and one session token per search session', async ({ page }) => {
  const searches = await mockPlaces(page, 'google');
  await page.goto('/new/pick');
  await openWhere(page);
  await page.keyboard.type('Rosa');
  await expect(opts(page)).toHaveCount(3);
  await expect(page.locator('.ps-credit')).toHaveText('Google Maps');
  await page.keyboard.type('r');
  await expect.poll(() => searches.length).toBe(2);
  expect(searches[0].session).toMatch(/^[\w-]{36}$/);
  expect(searches[1].session).toBe(searches[0].session);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  // A new search after a pick is a new session.
  await where(page).fill('');
  await page.keyboard.type('Ross');
  await expect.poll(() => searches.length).toBe(3);
  expect(searches[2].session).not.toBe(searches[0].session);
});

test('Where stays a plain field when place search is off', async ({ page }) => {
  let searched = false;
  await page.route('**/api/places?*', (route) => ((searched = true), route.abort()));
  await page.goto('/new/pick');
  await page.click('#more-box summary');
  await page.locator('#location').focus();
  await page.keyboard.type('Rosa');
  await page.waitForTimeout(600);
  expect(searched).toBe(false);
  await expect(page.locator('#location')).not.toHaveAttribute('role', 'combobox');
});
