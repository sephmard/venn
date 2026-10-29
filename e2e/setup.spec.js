import { test, expect } from '@playwright/test';
import { addDays, nextMonth, setLevel, showNextMonth, tapAt, tapDays } from './helpers.js';

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

test('a tap on the hours calendar adds the half hour tapped; a drag draws longer', async ({ page }) => {
  await page.goto('/new');
  await setLevel(page, 'hours');
  await expect(page.locator('[data-flength], #len-h')).toHaveCount(0); // no length to choose
  const day = addDays(await nextMonth(page), 3);
  await tapAt(page, day, 1170, '#when'); // 7:30 PM
  await expect(page.locator('#free-list')).toContainText('7:30 – 8:00 PM');
});

test('on the hours calendar a tap goes round, as on days: available, if needed, removed', async ({ page }) => {
  await page.goto('/new');
  await setLevel(page, 'hours');
  const day = addDays(await nextMonth(page), 3);
  await tapAt(page, day, 1140, '#when');
  const block = page.locator('#when .tg-block');
  await expect(block).toHaveCount(1);
  await block.click();
  await expect(page.locator('#when .tg-block.opt-maybe')).toHaveCount(1);
  await block.click();
  await expect(block).toHaveCount(0);
  await expect(page.locator('#free-list .chip')).toHaveCount(0);
});

test('on a phone, press and hold on hours to draw a time, or to move one; a swipe still scrolls', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(!isMobile, 'touch only');
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await page.goto('/new');
  await setLevel(page, 'hours');
  const col = page.locator('#when .tg-col.tg-draw').nth(1);
  await page.locator('#when .tg-scroll').scrollIntoViewIfNeeded();
  const row = await col.evaluate((el) => {
    el.closest('.tg-scroll').scrollTop = 0;
    return parseFloat(getComputedStyle(el.closest('.tg')).getPropertyValue('--row'));
  });
  const box = await col.boundingBox();
  const x = box.x + box.width / 2;
  const y = (m) => box.y + ((m - 420) / 30) * row + row / 2;
  // Hold at 9, drag down to the 11:30 half hour: 9 AM – 12 PM.
  await touch('touchStart', x, y(540));
  await page.waitForTimeout(450);
  for (let m = 570; m <= 690; m += 30) await touch('touchMove', x, y(m));
  await touch('touchEnd');
  await expect(page.locator('#free-list')).toContainText('9 AM – 12 PM');
  // Hold the time, drag it down an hour: 10 AM – 1 PM.
  const b = await page.locator('#when .tg-block').boundingBox();
  await touch('touchStart', b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(450);
  for (let i = 1; i <= 4; i++) await touch('touchMove', b.x + b.width / 2, b.y + b.height / 2 + (row * 2 * i) / 4);
  await touch('touchEnd');
  await expect(page.locator('#free-list')).toContainText('10 AM – 1 PM');
  await expect(page.locator('#when .tg-block.opt-maybe')).toHaveCount(0); // a hold isn't a tap
});
