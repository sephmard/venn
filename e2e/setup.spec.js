import { test, expect } from '@playwright/test';
import { addDays, nextMonth, setLevel, showNextMonth, tapDays } from './helpers.js';

// Setting up a poll holds no surprises: templates never move what's picked, Clear all can be undone,
// and a whole day is a whole day at every level.

const card = (page, name) => page.locator('.templates [data-occasion]', { hasText: name });
const threeDays = async (page) => {
  await showNextMonth(page);
  const first = await nextMonth(page);
  await tapDays(page, [addDays(first, 1), addDays(first, 3), addDays(first, 5)]);
};

test('a template shapes an empty calendar, but never what is already picked', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#organizer', 'Sam');
  // Nothing picked: Trip asks for days in a row, and a second tap takes it back.
  await card(page, 'Trip').click();
  await expect(page.locator('#in-row')).toBeChecked();
  await card(page, 'Trip').click();
  await expect(card(page, 'Trip')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#in-row')).not.toBeChecked();
  // Days picked first: Trip names the poll and leaves the days as they are.
  await threeDays(page);
  await card(page, 'Trip').click();
  await expect(page.locator('#in-row')).not.toBeChecked();
  await expect(page.locator('#summary')).toHaveText('3 days to choose from');
  // Its length shows only where lengths are chosen, and is never chosen out of sight.
  await card(page, 'Dinner').click();
  await setLevel(page, 'hours');
  await expect(page.locator('[data-flength="120"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-flength="120"]')).toBeVisible();
});

test('Clear all can be undone, until something new is picked', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#organizer', 'Sam');
  await threeDays(page);
  await page.click('#q-clear');
  await expect(page.locator('#free-list .chip')).toHaveCount(0);
  await expect(page.locator('#q-undo')).toBeFocused();
  await page.click('#q-undo');
  await expect(page.locator('#summary')).toHaveText('3 days to choose from');
  await expect(page.locator('#q-undo')).toHaveCount(0);
  await page.click('#q-clear');
  await tapDays(page, [addDays(await nextMonth(page), 8)]);
  await expect(page.locator('#q-undo')).toHaveCount(0);
  await expect(page.locator('#summary')).toHaveText('1 day to choose from');
});

test('a whole day is one "All day" at every level, with no gap between the parts', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#organizer', 'Sam');
  await showNextMonth(page);
  await tapDays(page, [addDays(await nextMonth(page), 2)]);
  await setLevel(page, 'parts');
  await expect(page.locator('#free-list .chip-flip')).toHaveText(['All day']);
  await setLevel(page, 'hours');
  await expect(page.locator('#free-list .chip-flip')).toHaveText(['All day']);
  // Its × takes the whole day away.
  await setLevel(page, 'parts');
  await page.locator('#free-list [data-rm-window]').click();
  await expect(page.locator('#free-list .chip')).toHaveCount(0);
});

test('with nothing picked, every level says the same thing: pick at least one day', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#organizer', 'Sam');
  for (const level of ['days', 'parts', 'hours']) {
    await setLevel(page, level);
    await expect(page.locator('#summary')).toHaveText('Pick at least one day to create the poll');
  }
});

test('parts of the day and hours both go a week with ‹ › and a month with « »', async ({ page }) => {
  await page.goto('/new');
  for (const level of ['parts', 'hours']) {
    await setLevel(page, level);
    const label = page.locator('#when .tv-label');
    await expect(label).not.toBeEmpty();
    const now = await label.textContent();
    await expect(page.locator('#when').getByRole('button', { name: 'Back a month' })).toBeDisabled();
    await page.locator('#when').getByRole('button', { name: 'Forward a month' }).click();
    await expect(label).not.toHaveText(now);
    await page.locator('#when').getByRole('button', { name: 'Back a month' }).click();
    await expect(label).toHaveText(now); // back to this week, not before
  }
});
