import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Topic polls: decide what or where (not when), then find a date for it.

async function noBlockingA11y(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking,
    `${label}\n${blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n')}`,
  ).toEqual([]);
}

/** Make a topic poll from /new and land on it as its organizer. */
async function createTopic(page, { title, options, yesNo = false, single = false }) {
  await page.goto('/new');
  await page.getByRole('link', { name: '🗳️ Vote' }).click();
  await expect(page).toHaveURL(/\/new\/topic$/);
  // The kind of question first, then the question itself (its example changes to fit).
  if (yesNo) {
    await page.getByRole('radio', { name: 'Yes or no' }).click();
    await expect(page.locator('#title')).toHaveAttribute('placeholder', 'Should we do a book swap?');
    await expect(page.locator('#yesno')).toHaveText(/Everyone answers\s*Yes\s*No/);
  }
  await page.getByLabel('Your question').fill(title);
  if (!yesNo) {
    for (let i = 0; i < options.length; i++) {
      if (i >= 2) await page.getByRole('button', { name: '+ Add option' }).click();
      await page.getByLabel(`Option ${i + 1}`, { exact: true }).fill(options[i]);
    }
    if (single) await page.getByRole('switch', { name: 'One pick each' }).check();
  }
  await page.getByLabel(/Your name/).fill('Priya');
  await page.click('#submit');
  await page.locator('.party-go').click();
  await page.locator('.party').waitFor({ state: 'detached' });
  await expect(page).toHaveURL(/\/e\/\w+$/);
  return page.url();
}

async function answer(browser, url, name, votes) {
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(url);
  for (const [label, vote] of votes) {
    const row = g.locator('.topic-row', { hasText: label });
    if (vote === 'pick') await row.click();
    else await row.getByRole('radio', { name: vote }).click();
  }
  await g.getByLabel('Your name').fill(name);
  await g.getByRole('button', { name: 'Submit' }).click();
  await expect(g.locator('#toast')).toContainText('your answer is in');
  await ctx.close();
}

test('vote on options, pick the favourite, then find a date for it', async ({ page, browser }) => {
  const url = await createTopic(page, { title: 'Where should we eat?', options: ["Rosa's", "Luigi's", 'Taco Loco'] });
  await expect(page.getByRole('heading', { name: 'Where should we eat?' })).toBeVisible();
  await noBlockingA11y(page, 'topic poll, organizer');

  await answer(browser, url, 'Marcus', [
    ["Rosa's", 'Yes'],
    ["Luigi's", 'No'],
    ['Taco Loco', 'If needed'],
  ]);
  await answer(browser, url, 'Ana', [
    ["Rosa's", 'Yes'],
    ['Taco Loco', 'Yes'],
  ]);

  await page.reload();
  await expect(page.locator('.best-hero')).toContainText("Rosa's");
  await expect(page.locator('.best-hero')).toContainText('2 of 2 would go');
  await expect(page.locator('.t-result', { hasText: 'Taco Loco' })).toContainText('1 yes · 1 if needed');
  await page.getByRole('button', { name: "Pick Rosa's" }).click();
  await expect(page.getByRole('heading', { name: "Go with Rosa's?" })).toBeVisible();
  await page.getByRole('button', { name: 'Pick it' }).click();
  await expect(page.locator('.banner-final')).toContainText("Decided Rosa's");

  // Guests see what was decided.
  const g = await (await browser.newContext()).newPage();
  await g.goto(url);
  await expect(g.locator('.banner-final h2')).toHaveText("Rosa's");
  await expect(g.getByRole('link', { name: 'Find a date for it' })).toHaveCount(0);
  await noBlockingA11y(g, 'topic poll, decided, guest');
  await g.close();

  // The organizer finds a date for it: a date poll with what was decided filled in.
  await page.getByRole('link', { name: 'Find a date for it' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator('#title')).toHaveValue("Rosa's");
  await expect(page.locator('#location')).toHaveValue("Rosa's");
});

test('a yes or no question takes one pick each', async ({ page, browser }) => {
  const url = await createTopic(page, { title: 'Should we do a trip this spring?', yesNo: true });
  await answer(browser, url, 'Jordan', [['Yes', 'pick']]);
  const g = await (await browser.newContext()).newPage();
  await g.goto(url);
  await expect(g.getByRole('heading', { name: 'What do you say?' })).toBeVisible();
  const yes = g.getByRole('radio', { name: 'Yes' });
  await yes.click();
  await expect(yes).toHaveAttribute('aria-checked', 'true');
  // One pick: choosing No takes Yes away.
  await g.getByRole('radio', { name: 'No' }).click();
  await expect(yes).toHaveAttribute('aria-checked', 'false');
  await expect(g.locator('.t-result').first()).toContainText('Yes1 vote');
  await noBlockingA11y(g, 'yes or no poll, guest');
  await g.close();
});

test('the topic form says what is missing', async ({ page }) => {
  await page.goto('/new/topic');
  // No date-poll templates, no made-up name: the question is typed in full.
  await expect(page.locator('.occasions')).toHaveCount(0);
  await expect(page.locator('#title')).toHaveValue('');
  await page.getByLabel(/Your name/).fill('Lee');
  await page.getByLabel('Option 1', { exact: true }).fill('Dune');
  await page.getByLabel('Option 2', { exact: true }).fill('Piranesi');
  await expect(page.locator('#summary')).toContainText('Add your question');
  await page.getByLabel('Your question').fill('Which book next?');
  await page.getByLabel('Option 1', { exact: true }).fill('Dune');
  await page.getByLabel('Option 2', { exact: true }).fill('dune');
  await expect(page.locator('#summary')).toContainText('in the list twice');
  await page.getByLabel('Option 2', { exact: true }).fill('Piranesi');
  await expect(page.locator('#summary')).toHaveText('2 options to vote on');
  await noBlockingA11y(page, 'topic create page');
});

test('the Date · Vote switch is the same on both forms, and Back goes between them', async ({ page }) => {
  await page.goto('/new');
  const nav = page.getByRole('navigation', { name: 'Kind of Venn' });
  await expect(nav.getByRole('link', { name: '📅 Date' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: '🗳️ Vote' }).click();
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(nav.getByRole('link', { name: '🗳️ Vote' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.create-lede')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/new$/);
  await expect(nav.getByRole('link', { name: '📅 Date' })).toHaveAttribute('aria-current', 'page');
  const widths = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(widths).toBeLessThanOrEqual(0);
});
