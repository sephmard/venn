import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { TOPIC_TEMPLATES } from '../public/topic-templates.js';

// Starters for a vote (public/topic-templates.js): the pill row on /new/topic, the ?template= link
// that presses one, the draft that keeps it, and the "Vote on what to do" cards on /templates.

const starter = (page, name) => page.getByRole('group', { name: 'Starters' }).getByRole('button', { name });
const option = (page, n) => page.getByLabel(`Option ${n}`, { exact: true });
const noSideways = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

async function noBlockingA11y(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, `${label}\n${blocking.map((v) => v.id).join('\n')}`).toEqual([]);
}

test('vote starters: they fill the question, kind and hints, and never what was typed', async ({ page }) => {
  await page.goto('/new/topic');
  await expect(page.getByRole('group', { name: 'Starters' }).getByRole('button')).toHaveText(
    TOPIC_TEMPLATES.map((t) => new RegExp(t.label)),
  );
  await noSideways(page);
  await noBlockingA11y(page, '/new/topic');

  // Where to eat: its question, three empty rows with its hint, its emoji, pressed.
  await starter(page, 'Where to eat').click();
  await expect(starter(page, 'Where to eat')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#title')).toHaveValue('Where should we eat?');
  await expect(page.locator('#opts input')).toHaveCount(3);
  for (const n of [1, 2, 3]) {
    await expect(option(page, n)).toHaveValue('');
    await expect(option(page, n)).toHaveAttribute('placeholder', 'Place, e.g. Luigi’s');
  }
  await expect(page.locator('#emoji-tile')).toHaveText('🍜');

  // Another starter swaps its own in, since nothing was typed.
  await starter(page, 'What to do').click();
  await expect(starter(page, 'Where to eat')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#title')).toHaveValue('What should we do?');
  await expect(option(page, 1)).toHaveAttribute('placeholder', 'Idea, e.g. bowling');
  await expect(page.locator('#emoji-tile')).toHaveText('🎳');

  // A typed question and a typed option stay; the empty rows take the new hints.
  await page.locator('#title').fill('Book for March?');
  await option(page, 2).fill('Piranesi');
  await starter(page, 'Next book').click();
  await expect(page.locator('#title')).toHaveValue('Book for March?');
  await expect(option(page, 2)).toHaveValue('Piranesi');
  await expect(option(page, 1)).toHaveAttribute('placeholder', 'Book title');

  // Tapped again, it lets go: the usual hints come back, and nothing typed goes.
  await starter(page, 'Next book').click();
  await expect(starter(page, 'Next book')).toHaveAttribute('aria-pressed', 'false');
  await expect(option(page, 1)).toHaveAttribute('placeholder', "Rosa's");
  await expect(option(page, 2)).toHaveValue('Piranesi');
  await expect(page.locator('#emoji-tile')).toHaveText('🗳️');

  // Are we in? (yes or no) switches the kind and waits for the question.
  await page.locator('#title').fill('');
  await starter(page, 'Are we in?').click();
  await expect(page.getByRole('radio', { name: 'Yes or no' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#yesno')).toBeVisible();
  await expect(page.locator('#title')).toBeFocused();
  await expect(page.locator('#title')).toHaveValue('');
  await expect(page.locator('#title')).toHaveAttribute('placeholder', 'Should we…?');
  // Switching back to options by hand lets go of it.
  await page.getByRole('radio', { name: 'Pick from options' }).click();
  await expect(starter(page, 'Are we in?')).toHaveAttribute('aria-pressed', 'false');
});

test('vote starters: a link presses one, a reload keeps it, and the poll is what was typed', async ({ page, browser }) => {
  await page.goto('/new/topic?template=where-to-eat');
  await expect(starter(page, 'Where to eat')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#title')).toHaveValue('Where should we eat?');
  await expect(page).toHaveURL(/\/new\/topic$/);
  const places = ['Rosa’s', 'Luigi’s', 'Taco Loco'];
  for (const [i, p] of places.entries()) await option(page, i + 1).fill(p);

  // A reload puts it all back, still pressed.
  await page.reload();
  await expect(starter(page, 'Where to eat')).toHaveAttribute('aria-pressed', 'true');
  await expect(option(page, 3)).toHaveValue('Taco Loco');
  await expect(option(page, 1)).toHaveAttribute('placeholder', 'Place, e.g. Luigi’s');

  await page.getByLabel(/Your name/).fill('Priya');
  await page.click('#submit');
  await page.locator('.party-go').click();
  await page.locator('.party').waitFor({ state: 'detached' });
  await expect(page).toHaveURL(/\/e\/\w+$/);
  const url = page.url();

  // A guest sees exactly the three places typed, and the starter's emoji.
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(url);
  await expect(g.getByRole('heading', { name: 'Where should we eat?' })).toBeVisible();
  await expect(g.locator('.topic-row')).toHaveCount(3);
  for (const p of places) await expect(g.locator('.topic-row', { hasText: p })).toHaveCount(1);
  const ev = await (await g.request.get(`/api/events/${url.split('/e/')[1]}`)).json();
  expect(ev.emoji).toBe('🍜');
  expect(ev.options.map((o) => o.label)).toEqual(places);
  await ctx.close();
});

test('vote starters: a link that names none, or a date template, leaves the form as it is', async ({ page }) => {
  for (const name of ['nope', 'book-club']) {
    await page.goto(`/new/topic?template=${name}`);
    await expect(page.locator('#title')).toHaveValue('');
    await expect(page.locator('[data-starter][aria-pressed="true"]')).toHaveCount(0);
  }
});

test('/templates: "Vote on what to do" starts each vote on the form, pressed', async ({ page }) => {
  await page.goto('/templates');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Vote on what to do' }) });
  await expect(section.locator('.tpl-card')).toHaveCount(TOPIC_TEMPLATES.length);
  await noSideways(page);
  await noBlockingA11y(page, '/templates');
  await section.getByRole('link', { name: /Next book/ }).click();
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(starter(page, 'Next book')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#title')).toHaveValue('Which book should we read next?');
});
