// The AI box's hint and this week's free AI requests (GET /api/ai/allowance): while they last it
// says nothing about keys; once they're used up it says so plainly, then offers "Use your own key".
import { test, expect } from '@playwright/test';

const allowance = (page, state) => page.route('**/api/ai/allowance', (route) => route.fulfill({ json: { allowance: state } }));
const hint = (page) => page.locator('#ai-draft > .hint');
const keyLink = (page) => page.locator('#ai-draft [data-ai-key]');

/** Open Use AI and wait for the allowance to be asked. */
async function open(page) {
  const asked = page.waitForResponse((r) => r.url().endsWith('/api/ai/allowance'));
  await page.click('#ai-open');
  await asked;
}

test('AI allowance: while the free requests last, no key link and no word about keys', async ({ page }) => {
  await page.goto('/new');
  await open(page);
  await expect(hint(page)).toHaveText('Sent to Anthropic’s Claude. Check everything before you create the poll.');
  await expect(keyLink(page)).toHaveCount(0);
  await page.goto('/new/topic');
  await open(page);
  await expect(hint(page)).not.toContainText('key');
  await expect(keyLink(page)).toHaveCount(0);
});

test('AI allowance: used up on Create a Venn, it says Venn reads the words itself, then offers a key', async ({ page }) => {
  await allowance(page, 'used');
  await page.goto('/new');
  await open(page);
  await expect(hint(page)).toHaveText(
    'This week’s free AI requests are used up, so Venn reads this itself. Check everything before you create the poll. Use your own key',
  );
  const box = await keyLink(page).boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44); // to tap, though it sits in a line of text
  // With a key of their own saved, AI answers again, so the hint says where it goes.
  await keyLink(page).click();
  await page.fill('#ai-key-in', `sk-ant-${'x'.repeat(30)}`);
  await page.click('#ai-key-save');
  await expect(hint(page)).toHaveText('Sent to Anthropic’s Claude. Check everything before you create the poll. Your key');
});

test('AI allowance: used up on a vote, it says so before the key link', async ({ page }) => {
  await allowance(page, 'used');
  await page.goto('/new/topic');
  await open(page);
  await expect(hint(page)).toHaveText(
    'This week’s free AI requests are used up. Check everything before you create the poll. Use your own key',
  );
});

test('AI allowance: a server with no free requests offers the key, and a saved key shows as Your key', async ({ page }) => {
  await allowance(page, 'off');
  await page.goto('/new/topic');
  await open(page);
  await expect(page.locator('#ai-key-link')).toHaveText('Use your own key');
  await page.unroute('**/api/ai/allowance');
  await page.evaluate(() => localStorage.setItem('venn:anthropic-key', `sk-ant-${'y'.repeat(30)}`));
  await page.goto('/new');
  await page.click('#ai-open');
  await expect(page.locator('#ai-key-link')).toHaveText('Your key');
});

test('AI allowance: a 402 the page didn’t expect still opens the key form', async ({ page }) => {
  await page.goto('/new/topic');
  await page.route('**/api/ai/draft-topic', (route) =>
    route.fulfill({
      status: 402,
      json: { error: "You've used this week's free AI requests. Add your own Anthropic API key to keep going." },
    }),
  );
  await open(page);
  await expect(keyLink(page)).toHaveCount(0);
  await page.fill('#ai-prompt', 'Dinner Friday: Rosa’s or Luigi’s');
  await page.click('#ai-go');
  await expect(page.locator('#ai-key-box')).toContainText("You've used this week's free AI requests.");
  await expect(page.locator('#ai-key-in')).toBeFocused();
});
