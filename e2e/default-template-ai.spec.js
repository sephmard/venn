import { test, expect } from '@playwright/test';

// A default template and Ask AI (sprint D, C6, journey 12): what the AI writes always wins over the
// template's starting text, and the template keeps only its look. On the Venn with AI (fake-anthropic.js);
// the account's defaults are stood in for here, as that Venn has no sign-in.

const DATE_NIGHT = 'I’m only free wed Thu and the weekend this week, create a date poll for a date night with my wife.';

test('Ask AI on a form in the default template: the AI’s title, the template’s look', async ({ page }) => {
  const { id } = await (
    await page.request.post('/api/brands', { data: { name: 'Riverside', title: 'Book club', where: 'The library' } })
  ).json();
  await page.addInitScript(() => localStorage.setItem('venn:account', JSON.stringify({ initial: 'S', name: 'Sam' })));
  await page.route('**/api/me/defaults', (r) =>
    r.fulfill({ json: { defaults: { date: { id, name: 'Riverside' }, vote: null } } }),
  );
  await page.goto('/new');
  await expect(page.locator('#default-note')).toBeVisible();
  await expect(page.locator('#title')).toHaveValue('Book club');
  await page.fill('#organizer', 'Sam');
  if (await page.locator('#ai-draft').isHidden()) await page.click('#ai-open');
  await page.fill('#ai-prompt', DATE_NIGHT);
  await page.click('#ai-go');
  await expect(page.locator('#ai-done')).toBeVisible();
  // The AI's name for it; still Riverside's poll.
  await expect(page.locator('#title')).toHaveValue('Date night');
  await expect(page.locator('.brand-bar')).toContainText('Riverside');
  await expect(page.locator('#default-note')).toBeVisible();
});
