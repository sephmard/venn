// The box under Date · Vote on a Venn without AI ("Say when, and Venn picks the days"): Venn reads plain words itself (src/days-parse.js) and fills
// in the days for review, with Undo, as Use AI does. On the Venn with sign-in (ACCOUNTS_URL), which
// has no AI (NO_AI_URL, for a local run on other ports).
import { test, expect } from '@playwright/test';
import { ACCOUNTS_URL } from '../playwright.config.js';
import { todayIn } from './helpers.js';

test.use({ baseURL: process.env.NO_AI_URL || ACCOUNTS_URL });

/** Next month's Fridays, YYYY-MM-DD, from the page's own today. */
async function fridaysNextMonth(page) {
  const [y, m] = (await todayIn(page)).split('-').map(Number);
  const out = [];
  for (let d = new Date(Date.UTC(y, m, 1)); d.getUTCMonth() === m % 12; d.setUTCDate(d.getUTCDate() + 1))
    if (d.getUTCDay() === 5) out.push(d.toISOString().slice(0, 10));
  return out;
}

test('no AI: “Fridays next month” picks next month’s Fridays to review, and Undo puts it back', async ({ page, request }) => {
  await page.goto('/new');
  await expect(page.getByRole('button', { name: 'Use AI' })).toHaveCount(0); // nothing says AI where there's none
  await page.getByRole('button', { name: 'Say when, and Venn picks the days' }).click();
  await expect(page.locator('#ai-draft .hint')).toHaveText('Venn reads this itself. Check the days before you create the poll.');
  await expect(page.locator('#ai-key-link')).toBeEmpty();

  // Words it can't read: said in the box, and the calendar is still there to tap.
  await page.fill('#ai-prompt', 'whenever suits');
  await page.click('#ai-go');
  await expect(page.locator('#ai-err')).toContainText('Name them, like “Fridays next month”, or pick them below.');

  await page.fill('#ai-prompt', 'Fridays next month');
  await page.click('#ai-go');
  const done = page.locator('#ai-done');
  await expect(done).toBeVisible();
  await expect(done.locator('.ai-done-note')).toHaveText('Read from your words. Check the days.');
  const fridays = await fridaysNextMonth(page);
  const label = (d) =>
    new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T00:00:00Z`));
  for (const d of fridays) await expect(done.locator('.ai-done-when')).toContainText(await page.evaluate(label, d));

  // Undo, then again, then the poll: those Fridays, whole days.
  await done.getByRole('button', { name: 'Undo' }).click();
  await expect(done).toHaveCount(0);
  await expect(page.locator('#free-list .chip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Say when, and Venn picks the days' }).click();
  await page.click('#ai-go');
  await expect(done).toBeVisible();
  await page.fill('#title', 'Pub quiz');
  await page.fill('#organizer', 'Sam');
  // This Venn has email on, so the organizer gives one (it goes to the stand-in, never out).
  await page.fill('#notify', 'sam@venn.test');
  await page.getByRole('button', { name: 'Create a Venn' }).click();
  await expect(page).toHaveURL(/\/e\/\w+/);
  const id = new URL(page.url()).pathname.split('/')[2];
  const ev = await (await request.get(`/api/events/${id}`)).json();
  expect(ev.dates).toEqual(fridays);
  expect(ev.slotMinutes).toBe(1440);
});

test('no AI: words it can’t read under an earlier draft say the draft is still there, and mark it as the last one', async ({
  page,
}) => {
  await page.goto('/new');
  await page.getByRole('button', { name: 'Say when, and Venn picks the days' }).click();
  const [err, done] = [page.locator('#ai-err'), page.locator('#ai-done')];
  const still = 'Your last draft is still below, unchanged.';

  // Refused with no draft yet: the reason alone.
  await page.fill('#ai-prompt', 'Friday evening or Saturday afternoon');
  await page.click('#ai-go');
  await expect(err).toContainText('Say one time for all the days');
  await expect(err).not.toContainText(still);

  // A draft, then words it can't read: the alert says the draft is still below, and the card is the last one.
  const open = async () => {
    if (await page.locator('#ai-draft').isHidden())
      await page.getByRole('button', { name: 'Say when, and Venn picks the days' }).click();
  };
  const refuse = async () => {
    await open();
    await page.fill('#ai-prompt', 'Friday evening or Saturday afternoon');
    await page.click('#ai-go');
    await expect(err).toHaveText(/Say one time for all the days.*Your last draft is still below, unchanged\.$/);
    await expect(done).toHaveClass(/\bstale\b/);
    await expect(done.locator('.ai-done-kicker')).toHaveText('Last draft');
    await expect(done.getByRole('button', { name: 'Undo' })).toBeEnabled();
  };
  await page.fill('#ai-prompt', 'Fridays next month');
  await page.click('#ai-go');
  await expect(done).toBeVisible();
  await expect(done).not.toHaveClass(/\bstale\b/);
  await refuse();
  await refuse(); // again: still one kicker
  await expect(done.locator('.ai-done-kicker')).toHaveCount(1);

  // The next good fill replaces it: no "Last draft", nothing about it in the box.
  await open();
  await page.fill('#ai-prompt', 'Fridays next month');
  await page.click('#ai-go');
  await expect(done).toBeVisible();
  await expect(done).not.toHaveClass(/\bstale\b/);
  await expect(done.locator('.ai-done-kicker')).toHaveCount(0);
  await expect(err).toBeEmpty();

  // Undo clears it too: the card goes, and the reason no longer points at it.
  await refuse();
  await done.getByRole('button', { name: 'Undo' }).click();
  await expect(done).toHaveCount(0);
  await expect(err).toContainText('Say one time for all the days');
  await expect(err).not.toContainText(still);
});
