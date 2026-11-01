import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pickDays } from './helpers.js';

// Brand templates (/brand): an organization makes its own, with a logo, colour and font; its team
// makes polls from the share link; guests see the organization's look. No accounts: a manage link.

// A red logo, to offer its colour.
const RED_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#e63946"/></svg>',
);
/** Open a step of the editor: from the list of steps (wide screens) or the step menu (phones). */
async function openStep(page, id) {
  const listed = page.locator(`.steps [data-step="${id}"]`);
  if (await listed.isVisible()) return listed.click();
  await page.locator('#step-menu summary').click();
  await page.locator(`#step-menu [data-step="${id}"]`).click();
}
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
  test.setTimeout(60_000); // every step of the editor, three scans, then four browsers
  // From the website menu.
  await page.goto('/');
  await page.locator('summary[aria-label="Menu"]').click();
  await page.getByRole('link', { name: 'For organizations' }).click();
  // For organizations: a poll in a made-up organization's look, and one button.
  await expect(page.locator('h1')).toHaveText('Your brand on every poll');
  await expect(page.frameLocator('#pv-frame').locator('.brand-bar')).toHaveText('Northwind');
  await noSideways(page);
  await page.getByRole('link', { name: 'Make your template' }).click();
  await expect(page).toHaveURL(/\/brand\/new$/);
  await expect(page.locator('h1')).toHaveText('Make a brand template');
  // The preview is the real poll page, with a sample poll, in the template's look as it's made.
  const pv = page.frameLocator('#pv-frame');
  await expect(pv.locator('.brand-bar')).toBeVisible();
  const look = (prop) => pv.locator('html').evaluate((el, p) => getComputedStyle(el).getPropertyValue(p).trim(), prop);
  const venn = await look('--accent');
  // A step at a time, in the poll page's order: the first is its name and logo, and the preview
  // rings the part of the poll each step changes.
  await expect(page.locator('[data-panel="name"]')).toBeVisible();
  // On a phone the editor is the screen: the page doesn't scroll (only the step does), so nothing
  // slides under the preview.
  if (page.viewportSize().width < 960)
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(0);
  await expect(page.locator('[data-panel="colours"]')).toBeHidden();
  await expect(page.locator('#back')).toBeDisabled();
  await page.fill('#b-name', 'Acme Inc.');
  await expect(pv.locator('.brand-bar')).toHaveText('Acme Inc.');
  await expect(pv.locator('.brand-bar.pv-spot')).toBeVisible();
  // The logo: uploaded, then its size; the size and name switch only show once there's one.
  await expect(page.getByRole('button', { name: 'Upload logo' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Large' })).toBeHidden();
  await page.setInputFiles('#logo-file', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: RED_LOGO });
  await expect(pv.locator('.brand-bar img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change logo' })).toBeVisible();
  await page.getByRole('radio', { name: 'Large' }).click();
  await expect(pv.locator('.brand-bar img')).toHaveCSS('height', '96px');
  // Next: a look to start from, and one in the logo's colour.
  await page.click('#next');
  await expect(page.locator('[data-panel="look"]')).toBeVisible();
  await page.locator('[data-look="midnight"]').click();
  await expect.poll(() => look('--bg')).toBe('#0e1220');
  expect(await look('--radius')).toBe('22px');
  await page.locator('[data-look="logo"]').click();
  await expect.poll(() => look('--accent')).not.toBe(venn);
  expect(await page.locator('#b-accent').inputValue()).toMatch(/^#e[0-9a-f]3[0-9a-f]4[0-9a-f]$/);
  // Held, Compare shows Venn's own look; let go, the template's.
  await page.locator('#pv-compare').dispatchEvent('pointerdown');
  await expect(pv.locator('html')).not.toHaveClass(/branded/);
  await page.locator('#pv-compare').dispatchEvent('pointerup');
  await expect(pv.locator('html')).toHaveClass(/branded/);
  // Colours: its own, and the buttons it changes are rung in the preview.
  await page.click('#next');
  await expect(page.locator('[data-panel="colours"]')).toBeVisible();
  await expect(pv.locator('.btn-primary.pv-spot').first()).toBeVisible();
  await page.locator('#b-accent').evaluate((el) => {
    el.value = '#6d28d9';
    el.dispatchEvent(new Event('input'));
  });
  // The page itself keeps Venn's own look (retro, by default).
  await expect(page.locator('html')).toHaveClass(/retro/);
  await expect(page.locator('html')).not.toHaveClass(/branded/);
  // A page of its own, its answers, fonts, corners and buttons: the preview takes them on.
  await page.locator('[data-page="own"]').click();
  for (const [id, value] of [
    ['#b-bg', '#fff4e6'],
    ['#b-text', '#3d2c1e'],
  ])
    await page.locator(id).evaluate((el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input'));
    }, value);
  // Answers: the preview goes to the group's answers, where their colours show.
  await page.click('#next');
  await expect(pv.locator('.ov-list.pv-spot')).toBeVisible();
  await page.locator('[data-answers="own"]').click();
  await page.locator('#b-yes').evaluate((el) => {
    el.value = '#1d4ed8';
    el.dispatchEvent(new Event('input'));
  });
  await openStep(page, 'headings');
  await page.locator('[data-font="slab"]').click();
  await openStep(page, 'text');
  await page.locator('[data-body-font="humanist"]').click();
  await openStep(page, 'shape');
  await page.getByRole('radio', { name: 'Square' }).click();
  await page.getByRole('radio', { name: 'Match the corners' }).click();
  await expect.poll(() => look('--bg')).toBe('#fff4e6');
  await expect.poll(() => look('--radius')).toBe('4px');
  expect(await look('--serif')).toMatch(/Rockwell/);
  expect(await look('--yes')).toBe('#1d4ed8');
  await expect(pv.locator('.btn').first()).toHaveCSS('border-radius', '4px');
  // The last step: what polls start with, and Save in place of Next.
  await expect(page.locator('#submit')).toBeHidden();
  await page.click('#next');
  await expect(page.locator('#next')).toBeHidden();
  await page.fill('#b-title', 'Team lunch');
  await page.fill('#b-where', 'The office');
  await expect(pv.locator('h1')).toContainText('Team lunch');
  await expect(pv.locator('#ev-details')).toContainText('The office');
  // Back goes a step back, and the steps can be opened in any order.
  await page.click('#back');
  await expect(page.locator('[data-panel="shape"]')).toBeVisible();
  await openStep(page, 'poll');
  // It can be used: an answer in the preview stays in the preview, and nothing reaches the server.
  const sent = [];
  page.on('request', (r) => r.url().includes('/api/events') && sent.push(r.url()));
  await pv.locator('.vote .v-yes').first().click();
  await expect(pv.locator('.vote .v-yes').first()).toHaveAttribute('aria-checked', 'true');
  // And as the organizer: their tools, in the same look.
  await page.getByRole('radio', { name: 'Organizer' }).click();
  await expect(pv.getByRole('button', { name: 'Copy link' })).toBeVisible();
  expect(await look('--bg')).toBe('#fff4e6');
  await page.getByRole('radio', { name: 'Guest' }).click();
  await expect(pv.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
  expect(sent).toEqual([]);
  await noSideways(page);
  // The preview at its top: scrolled, its sticky Submit bar half covers a row's buttons, which axe
  // counts as too small a target in so short a frame.
  await pv.locator('html').evaluate(() => scrollTo(0, 0));
  await audit(page, 'making a brand template');
  await page.click('#submit');

  // Saved: it opens on two links, one for the team and one to keep, and it's remembered in this browser.
  await expect(page.locator('[data-panel="share"]')).toBeVisible();
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
  // Its answers, its buttons and its logo size.
  expect(await guest.locator('html').evaluate((el) => getComputedStyle(el).getPropertyValue('--yes').trim())).toBe('#1d4ed8');
  await expect(guest.locator('.btn').first()).toHaveCSS('border-radius', '4px');
  await expect(guest.locator('.brand-bar img')).toHaveCSS('height', '96px');
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
  await expect(other.locator('h1')).toHaveText('Your brand on every poll');
  await guest.goto(poll);
  await expect(guest.locator('#ev-title')).toBeVisible();
  await expect(guest.locator('.brand-bar')).toHaveCount(0);
  await expect(guest.locator('html')).not.toHaveClass(/branded/);
});
