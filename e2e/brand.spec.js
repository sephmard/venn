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
const accent = (page, sel = 'html') =>
  page.locator(sel).evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim());
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
  // From the home page.
  await page.goto('/');
  await page.getByRole('link', { name: 'Make your template' }).click();
  await expect(page.locator('h1')).toHaveText('Make a brand template');
  // The page shows the look as it's chosen: the colour (made readable), the font, the logo and name.
  const venn = await accent(page, '#brand-preview');
  await page.fill('#b-name', 'Acme Inc.');
  await page.locator('#b-accent').evaluate((el) => {
    el.value = '#6d28d9';
    el.dispatchEvent(new Event('input'));
  });
  // The preview shows it; the page keeps Venn's own look (retro, by default).
  expect(await accent(page, '#brand-preview')).not.toBe(venn);
  await expect(page.locator('html')).toHaveClass(/retro/);
  await expect(page.locator('html')).not.toHaveClass(/branded/);
  // A page of its own, its fonts and corners: the preview takes them on.
  await page.getByRole('radio', { name: 'Your own' }).click();
  for (const [id, value] of [
    ['#b-bg', '#fff4e6'],
    ['#b-text', '#3d2c1e'],
  ])
    await page.locator(id).evaluate((el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input'));
    }, value);
  await page.locator('[data-font="slab"]').click();
  await page.locator('[data-body-font="humanist"]').click();
  await page.getByRole('radio', { name: 'Square' }).click();
  const look = (prop) =>
    page.locator('#brand-preview').evaluate((el, p) => getComputedStyle(el).getPropertyValue(p).trim(), prop);
  expect(await look('--bg')).toBe('#fff4e6');
  expect(await look('--radius')).toBe('4px');
  expect(await look('--serif')).toMatch(/Rockwell/);
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
  // Only the poll is branded: the create page keeps Venn's own look.
  await expect(team.locator('html')).toHaveClass(/retro/);
  await expect(team.locator('html')).not.toHaveClass(/branded/);
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
  expect(await accent(guest)).not.toBe(venn);
  // Its own page colours, in light or dark mode alike.
  expect(await guest.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 244, 230)');
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
