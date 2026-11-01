import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pickDays } from './helpers.js';

// Brand templates (/brand): an organization makes its own, with a logo, colour and font; its team
// makes polls from the share link; guests see the organization's look. No accounts: a manage link.

// A tiny PNG logo.
const LOGO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const accent = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
const noSideways = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

async function audit(page, label) {
  await page.evaluate(() => (document.getElementById('toast').textContent = ''));
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

test('brand template: make one, share it, and its polls show the organization’s look', async ({ page, browser }) => {
  await page.goto('/brand');
  await expect(page.locator('h1')).toHaveText('Make a brand template');
  // The page shows the look as it's chosen: the colour (made readable), the font, the logo and name.
  const venn = await accent(page);
  await page.fill('#b-name', 'Acme Inc.');
  await page.locator('#b-accent').evaluate((el) => {
    el.value = '#6d28d9';
    el.dispatchEvent(new Event('input'));
  });
  expect(await accent(page)).not.toBe(venn);
  await page.getByRole('radio', { name: 'Serif' }).click();
  await expect(page.getByRole('radio', { name: 'Serif' })).toHaveAttribute('aria-checked', 'true');
  await page.setInputFiles('#logo-file', { name: 'logo.png', mimeType: 'image/png', buffer: LOGO });
  await expect(page.locator('.brand-bar img')).toBeVisible();
  await expect(page.locator('.brand-bar')).toHaveText('Acme Inc.');
  await page.fill('#b-title', 'Team lunch');
  await page.fill('#b-where', 'The office');
  await noSideways(page);
  await audit(page, 'making a brand template');
  await page.click('#submit');

  // Saved: two links, one for the team and one to keep, and it's remembered in this browser.
  const links = page.locator('.brand-links input');
  await expect(links).toHaveCount(2);
  await expect(page).toHaveURL(/\/brand\/[A-Za-z0-9]+$/);
  const share = await links.nth(0).inputValue();
  const manage = await links.nth(1).inputValue();
  expect(share).toMatch(/\/new\?brand=[A-Za-z0-9]+$/);
  expect(manage).toMatch(/\/brand\/[A-Za-z0-9]+#admin=[A-Za-z0-9]+$/);
  await expect(page.locator('#b-name')).toHaveValue('Acme Inc.');
  await audit(page, 'managing a brand template');

  // A teammate, on another device, makes a poll from the share link: in the look, filled in.
  const team = await (await browser.newContext()).newPage();
  await team.goto(share);
  await expect(team.locator('.brand-bar')).toHaveText('Acme Inc.');
  await expect(team.locator('#title')).toHaveValue('Team lunch');
  await expect(team.locator('#location')).toHaveValue('The office');
  await expect(team.locator('html')).toHaveClass(/branded/);
  await expect(team.locator('html')).not.toHaveClass(/retro/);
  await expect(team.locator('#p-retro')).toBeHidden();
  await pickDays(team, 2);
  await team.fill('#organizer', 'Sam');
  await team.click('#submit');
  await team.locator('.party-go').click();
  await expect(team).toHaveURL(/\/e\/[A-Za-z0-9]+$/);
  const poll = team.url();

  // A guest sees the organization's logo, name and colour.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(poll);
  await expect(guest.locator('.brand-bar')).toHaveText('Acme Inc.');
  await expect(guest.locator('.brand-bar img')).toBeVisible();
  expect(await accent(guest)).toBe(await accent(page));
  await noSideways(guest);
  await audit(guest, 'a branded poll');

  // The share link alone can't change the template; it can only be used.
  await guest.goto(share.replace('/new?brand=', '/brand/'));
  await expect(guest.locator('h1')).toHaveText('Acme Inc.’s template');
  await expect(guest.locator('#brand-form')).toHaveCount(0);

  // The manage link works on any device, and the template can be deleted there: its polls go back
  // to Venn's look.
  const other = await (await browser.newContext()).newPage();
  await other.goto(manage);
  await expect(other.locator('#b-name')).toHaveValue('Acme Inc.');
  await expect(other).toHaveURL(/\/brand\/[A-Za-z0-9]+$/); // the token leaves the address bar
  await other.click('#b-delete');
  await other.click('#b-really');
  await expect(other.locator('h1')).toHaveText('Make a brand template');
  await guest.goto(poll);
  await expect(guest.locator('#ev-title')).toBeVisible();
  await expect(guest.locator('.brand-bar')).toHaveCount(0);
  await expect(guest.locator('html')).not.toHaveClass(/branded/);
});
