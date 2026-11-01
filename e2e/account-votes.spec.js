import { test, expect } from '@playwright/test';
import { ACCOUNTS_URL } from '../playwright.config.js';

// My polls with both kinds of poll: date polls and votes (topic polls). Each says what it is, open
// votes wait on their own, and the list can show only one kind. On a Venn with sign-in (ACCOUNTS_URL).
test.use({ baseURL: ACCOUNTS_URL });

test('My polls shows votes beside date polls, and can show only one kind', async ({ browser }, info) => {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': `votes-${info.project.name}-${Date.now()}` } });
  const page = await context.newPage();
  await page.goto('/me');
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.locator('.acct-who')).toBeVisible();

  // Made signed in, so they're kept with the account: one date poll, two votes (one decided).
  const date = {
    title: 'Supper club',
    organizer: 'Robin',
    timezone: 'Europe/London',
    dates: ['2031-03-03', '2031-03-04'],
    startMinute: 0,
    endMinute: 1440,
    slotMinutes: 1440,
    durationMinutes: 1440,
  };
  const vote = (title, ...labels) => ({
    title,
    organizer: 'Robin',
    timezone: 'Europe/London',
    mode: 'topic',
    options: labels.map((label) => ({ label })),
  });
  for (const data of [date, vote('Where should we eat?', "Rosa's", 'Taco Loco'), vote('Which book next?', 'Dune', 'Emma')]) {
    const res = await page.request.post('/api/events', { data });
    expect(res.ok()).toBe(true);
    const made = await res.json();
    if (data.title === 'Which book next?')
      await page.request.post(`/api/events/${made.id}/finalize`, {
        data: { option: 1 },
        headers: { 'x-admin-token': made.adminToken },
      });
  }

  await page.goto('/me');
  await expect(page.getByRole('tab', { name: /Created/ })).toContainText('3');
  await expect(page.locator('.acct-h')).toHaveText([/Waiting on a date/, /Waiting on a pick/, /Past/]);
  const eat = page.locator('.acct-row', { hasText: 'Where should we eat?' });
  await expect(eat).toContainText('Vote · No answers yet');
  await expect(eat.locator('.acct-icon')).toHaveText('🗳️');
  await expect(page.locator('.acct-row', { hasText: 'Supper club' }).locator('.acct-icon')).toHaveText('📅');

  // Only the votes: from the sort sheet, which now also says what to show.
  await page.locator('#acct-sortbtn').click();
  await expect(page.locator('.acct-sheet-h')).toHaveText('Show and sort');
  await page.getByRole('radio', { name: 'Votes' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#acct-sortlabel')).toHaveText('Votes');
  await expect(page.locator('.acct-row', { hasText: 'Supper club' })).toHaveCount(0);
  await expect(page.locator('.acct-h')).toHaveText([/Waiting on a pick/, /Past/]);
  // Past is folded; opened, the decided vote says what was picked.
  await page.locator('.acct-fold').click();
  await expect(page.locator('.acct-row', { hasText: 'Which book next?' })).toContainText('Vote · Decided: Dune');

  // Remembered: back to everything.
  await page.reload();
  await expect(page.locator('#acct-sortlabel')).toHaveText('Votes');
  await page.locator('#acct-sortbtn').click();
  await page.getByRole('radio', { name: 'All' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#acct-sortlabel')).toHaveText('Newest');
  await expect(page.locator('.acct-row', { hasText: 'Supper club' })).toHaveCount(1);
  await context.close();
});
