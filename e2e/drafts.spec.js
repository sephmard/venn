// Keeping people's work: a half-made poll and an unsent answer survive a reload or Back, and an
// organizer signed out can keep their link and find their polls on this device.

import { test, expect } from '@playwright/test';
import { nextMonth, addDays, tapDays, setLevel, afterSubmit } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

const viewPoll = (page) => page.getByRole('button', { name: /^(View poll|Open .+ →)$/ }).click();

test('a half-made date poll survives a reload, Back and the Vote switch', async ({ page }) => {
  await page.goto('/new');
  const first = await nextMonth(page);
  const days = [addDays(first, 2), addDays(first, 3)];
  await page.fill('#title', 'Cabin plans');
  await tapDays(page, days);
  await page.fill('#organizer', 'Sam');
  await expect(page.locator('#free-list')).toContainText('All day');

  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Cabin plans');
  await expect(page.locator('#organizer')).toHaveValue('Sam');
  await expect(page.locator('#free-list .opt-day, #free-list > *').first()).toBeVisible();
  for (const d of days) await expect(page.locator(`#when .cal-day[data-date="${d}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#draft-note')).toContainText('Picked up where you left off.');

  // Parts of the day come back on Parts of day.
  await setLevel(page, 'parts');
  await page.reload();
  await expect(page.locator('[data-level="parts"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#title')).toHaveValue('Cabin plans');

  // To the Vote form and back: the date poll is as it was, and so is the vote.
  await page.click('.kind-switch a[href^="/new/topic"]');
  // Type once the Vote form is drawn: until its code arrives, the date form is still the one on screen.
  await expect(page.locator('#opts input').first()).toBeVisible();
  await page.fill('#title', 'Where should we stay?');
  await page.locator('#opts input').first().fill('The lake house');
  await page.click('.kind-switch a[href="/new"]');
  await expect(page.locator('#title')).toHaveValue('Cabin plans');
  await page.goBack();
  await expect(page.locator('#title')).toHaveValue('Where should we stay?');
  await expect(page.locator('#opts input').first()).toHaveValue('The lake house');

  // Start over: a fresh form, and it stays fresh.
  await page.reload();
  await page.click('#draft-reset');
  await expect(page.locator('#title')).toHaveValue('');
  await expect(page.locator('#draft-note')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#opts input').first()).toHaveValue('');
});

test('typing while the Vote form is still loading never changes the date poll’s draft', async ({ page }) => {
  await page.goto('/new');
  const first = await nextMonth(page);
  await page.fill('#title', 'Cabin plans');
  await tapDays(page, [addDays(first, 2)]);
  // A slow phone: the Vote form's code takes a moment, and the date form is still on screen.
  await page.route('**/create-topic.js', async (r) => {
    await new Promise((done) => setTimeout(done, 800));
    await r.continue();
  });
  await page.click('.kind-switch a[href^="/new/topic"]');
  await page.fill('#title', 'Where should we stay?');
  await expect(page.locator('#opts input').first()).toBeVisible();
  await page.click('.kind-switch a[href="/new"]');
  await expect(page.locator('#title')).toHaveValue('Cabin plans');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Cabin plans');
});

test('while the Vote form loads, the date form says so and takes no typing', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#title', 'Cabin plans');
  // A slow phone: the Vote form's code takes a moment.
  let release;
  const held = new Promise((done) => (release = done));
  await page.route('**/create-topic.js', async (r) => {
    await held;
    await r.continue();
  });
  await page.click('.kind-switch a[href^="/new/topic"]');
  // The switch shows Vote at once, and the date form is quiet and can't be typed in.
  await expect(page.locator('.kind-switch a[href^="/new/topic"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.kind-switch a[href="/new"]')).not.toHaveAttribute('aria-current', 'page');
  const form = page.locator('#create');
  await expect(form).toHaveAttribute('aria-busy', 'true');
  expect(await form.evaluate((f) => f.inert)).toBe(true);
  // Tap the name field and type, as someone would who doesn't see anything happen yet.
  const box = await page.locator('#title').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type('Oops');
  await page
    .locator('#title')
    .press('End')
    .catch(() => {}); // inert: a tap or key reaches nothing
  await expect(page.locator('#title')).toHaveValue('Cabin plans');
  // The Vote form arrives ready to use.
  release();
  await expect(page.locator('#opts input').first()).toBeVisible();
  await expect(page.locator('#create')).not.toHaveAttribute('aria-busy', 'true');
  expect(await page.locator('#create').evaluate((f) => f.inert)).toBe(false);
  await page.fill('#title', 'Where should we stay?');
  await expect(page.locator('#title')).toHaveValue('Where should we stay?');
  // And the date poll is as it was left.
  await page.click('.kind-switch a[href="/new"]');
  await expect(page.locator('#title')).toHaveValue('Cabin plans');
});

test('a made poll leaves no draft, and a link that fills the form wins', async ({ page }) => {
  await page.goto('/new');
  const first = await nextMonth(page);
  await page.fill('#title', 'Book club');
  await tapDays(page, [addDays(first, 4)]);
  await page.fill('#organizer', 'Sam');
  await page.goto('/new?title=Brunch');
  await expect(page.locator('#title')).toHaveValue('Brunch');
  await page.goto('/new');
  await expect(page.locator('#title')).toHaveValue('Book club');
  await page.click('#submit');
  await viewPoll(page);
  await expect(page).toHaveURL(/\/e\//);
  await page.goto('/new');
  await expect(page.locator('#title')).toHaveValue('Get-together');
  await expect(page.locator('#free-list')).not.toContainText('All day');
});

test('a guest’s unsent answer survives a reload, and goes once sent', async ({ page, browser }) => {
  await page.goto('/new');
  const first = await nextMonth(page);
  await page.fill('#title', 'Game night');
  await tapDays(page, [addDays(first, 1), addDays(first, 2), addDays(first, 3)]);
  await page.fill('#organizer', 'Sam');
  await page.click('#submit');
  await viewPoll(page);
  const url = page.url().split('#')[0];

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(url);
  const rows = guest.locator('#mine .row');
  await rows.nth(0).locator('[data-vote="2"]').click();
  await rows.nth(1).locator('[data-vote="1"]').click();
  await guest.fill('#name', 'Priya');
  await guest.reload();
  await expect(guest.locator('#name')).toHaveValue('Priya');
  await expect(rows.nth(0).locator('[data-vote="2"]')).toHaveAttribute('aria-checked', 'true');
  await expect(rows.nth(1).locator('[data-vote="1"]')).toHaveAttribute('aria-checked', 'true');
  await expect(guest.locator('#toast')).toHaveText(/Your answers are back/);
  await guest.click('#save');
  await afterSubmit(guest);
  await guest.reload();
  await expect(guest.locator('#save-state')).toHaveText('Submitted');
  expect(await guest.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('venn:answer-draft:')))).toEqual([]);
});

test('signed out, an organizer keeps their link and finds the poll on this device', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/new');
  const first = await nextMonth(page);
  await page.fill('#title', 'Picnic');
  await tapDays(page, [addDays(first, 5)]);
  await page.fill('#organizer', 'Sam');
  await page.click('#submit');
  await viewPoll(page);
  const id = page.url().match(/\/e\/([A-Za-z0-9]+)/)[1];

  await expect(page.locator('#org-keep')).toContainText('Only this browser can change this poll.');
  await page.click('#keep-admin');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/e/${id}#admin=\\w+`));
  await expect(page.locator('#org-keep')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('details.organizer')).toBeVisible();
  await expect(page.locator('#org-keep')).toHaveCount(0); // once kept, it doesn't ask again

  await page.goto('/me');
  const device = page.locator('.acct-device');
  await expect(device.getByRole('heading', { name: 'On this device' })).toBeVisible();
  await device.getByRole('link', { name: /Picnic/ }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${id}$`));
  await expect(page.locator('details.organizer')).toBeVisible();
});
