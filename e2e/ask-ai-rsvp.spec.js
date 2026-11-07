// Use AI and RSVPs (ai-draft.js aiRsvp, src/ask-kind.js): a plan whose day is set moves to RSVP,
// filled in (name, day and time, spots, plus-ones), and the box sits in the same place on RSVP.
import { test, expect } from '@playwright/test';

const SAID = 'Dinner at mine Saturday 7pm, 10 people max, plus-ones ok';

async function ask(page, text) {
  if (await page.locator('#ai-draft').isHidden()) await page.click('#ai-open');
  await page.fill('#ai-prompt', text);
  await page.click('#ai-go');
  await expect(page.locator('#ai-done')).toBeVisible();
}

test('from Date, a set day moves to RSVP with its time and guest list, and Undo goes back', async ({ page }) => {
  await page.goto('/new');
  const created = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/events') && created.push(r));
  await ask(page, SAID);
  await expect(page).toHaveURL(/\/new\/rsvp$/);
  const done = page.locator('#ai-done');
  await expect(done.locator('.ai-kind')).toHaveText('Venn made this an RSVP, because the date is set.');
  await expect(done.locator('.ai-done-when')).toContainText('10 spots · Plus-ones');
  await expect(page.locator('#title')).toHaveValue('Dinner at mine');
  await expect(page.locator('#r-pick')).toContainText('Sat');
  await expect(page.locator('#r-pick')).toContainText('7');
  await expect(page.locator('#r-cap-on')).toBeChecked();
  await expect(page.locator('#r-cap')).toHaveValue('10');
  await expect(page.locator('#r-plus-on')).toBeChecked();
  await expect(page.locator('#r-approve')).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await done.getByRole('button', { name: 'Undo' }).click();
  await expect(page).toHaveURL(/\/new$/);
  expect(created).toHaveLength(0);
});

test('on RSVP, the box fills the form in place; Undo puts back what was there', async ({ page }) => {
  await page.goto('/new/rsvp');
  await expect(page.getByRole('button', { name: 'Describe it, and Venn sets it up' })).toBeVisible();
  await page.fill('#title', 'Mine');
  await ask(page, SAID);
  await expect(page).toHaveURL(/\/new\/rsvp$/);
  await expect(page.locator('#title')).toHaveValue('Mine'); // what was typed stays
  await expect(page.locator('#r-cap-on')).toBeChecked();
  await expect(page.locator('#r-pick strong')).toBeVisible();
  await page.locator('#ai-done').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#r-cap-on')).not.toBeChecked();
  await expect(page.locator('#r-plus-on')).not.toBeChecked();
  await expect(page.locator('#r-pick strong')).toHaveCount(0);
});
