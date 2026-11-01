import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ACCOUNTS_URL } from '../playwright.config.js';
import { pickDays, submit } from './helpers.js';

// Accounts, for whoever wants one: sign in with Google (a stand-in, e2e/fake-oauth.js) and every poll
// you organize is in My polls, on any device. On a Venn with sign-in switched on (ACCOUNTS_URL).
test.use({ baseURL: ACCOUNTS_URL });

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

const poll = (title) => ({
  title,
  organizer: 'Robin',
  timezone: 'Europe/London',
  dates: ['2031-03-03', '2031-03-04'],
  startMinute: 0,
  endMinute: 1440,
  slotMinutes: 1440,
  durationMinutes: 1440,
});

test('sign in, and the polls this browser organizes are in My polls, on any device', async ({ browser }, info) => {
  const who = `robin-${info.project.name}-${Date.now()}`;
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': who } });
  const page = await context.newPage();

  // A poll made before signing in: its organizer link is remembered in this browser.
  const made = await (await page.request.post('/api/events', { data: poll('Supper club') })).json();
  await page.goto(`/e/${made.id}#admin=${made.adminToken}`);
  await expect(page.locator('h1')).toContainText('Supper club');
  // A poll's page is for answering: no "Sign in" there.
  await expect(page.locator('.acct-signin')).toHaveCount(0);

  // The create page has it; it leads to My polls, with the ways to sign in.
  await page.goto('/new');
  await page.locator('.topbar .acct-signin').click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.locator('h1')).toHaveText('Sign in to Venn');
  await expect(page.locator('.acct-agree').getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  await expect(page.locator('html')).toHaveClass(/retro/);
  await noSideways(page);
  await audit(page, 'signed out');
  await page.getByRole('link', { name: 'Continue with Google' }).click();

  // Back, signed in: the remembered poll joined the account.
  await expect(page.locator('.acct-who')).toContainText('Robin Park');
  await expect(page.locator('#toast')).toHaveText('Added 1 poll from this browser');
  await expect(page.locator('.acct-list .acct-row')).toHaveCount(1);
  await expect(page.locator('.acct-row').first()).toContainText('Supper club');
  await expect(page.locator('.acct-row').first()).toContainText('No answers yet');
  await noSideways(page);
  await audit(page, 'signed in');

  // A poll made signed in is kept with the account straight away.
  await page.goto('/new');
  await page.fill('#organizer', 'Robin');
  await page.fill('#title', 'Board games');
  await pickDays(page, 2);
  // This Venn sends email (for email sign-in), so a new poll asks for the organizer's.
  await page.fill('#notify', 'robin@example.com');
  await page.click('#submit');
  await expect(page.locator('.party [role=status]')).toContainText('Your Venn is ready!');
  await expect(page.locator('.party')).toHaveCount(0, { timeout: 10_000 });
  // The top bar has the account: My polls and Sign out.
  await page.locator('.acct-menu summary').click();
  await page.getByRole('link', { name: 'My polls' }).click();
  await expect(page.locator('.acct-row')).toHaveCount(2);
  await expect(page.locator('.acct-row').first()).toContainText('Board games');

  // Another device, the same person: no links there, just signing in.
  const phone = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': who } });
  const other = await phone.newPage();
  await other.goto('/me');
  await other.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(other.locator('.acct-row')).toHaveCount(2);
  // A poll opens as its organizer, with the organizer's tools, without its link.
  await other.locator('.acct-row', { hasText: 'Supper club' }).click();
  await expect(other.locator('details.organizer summary')).toHaveText(/^Organizer tools$/);
  // The plain link, in a new tab there, is what guests see (as with the organizer link).
  const tab = await phone.newPage();
  await tab.goto(`/e/${made.id}`);
  await expect(tab.locator('#panel-mine > h2')).toHaveText(/available/);
  await expect(tab.locator('details.organizer')).toHaveCount(0);
  await tab.close();

  // Signing out, from the top bar.
  await other.goto('/me');
  await other.locator('.acct-menu summary').click();
  await other.locator('.acct-panel').getByRole('button', { name: 'Sign out' }).click();
  await expect(other.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expect(other.locator('.topbar .acct-signin')).toBeVisible();
  await phone.close();

  // Adding a poll from its organizer link (one made elsewhere, never opened here).
  const elsewhere = await (await page.request.post('/api/events', { data: poll('Cabin trip') })).json();
  await page.goto('/me');
  await page.locator('.acct-add summary').click();
  await page.fill('#acct-link', `${ACCOUNTS_URL}/e/${elsewhere.id}#admin=${elsewhere.adminToken}`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.acct-row')).toHaveCount(3);

  // Deleting the account is in Account settings, and asks twice; the polls stay, with their links.
  await page.getByRole('link', { name: 'Account settings' }).click();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('button', { name: 'Yes, delete my account' }).click();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await page.goto(`/e/${made.id}`);
  await expect(page.locator('h1')).toContainText('Supper club');
  await context.close();
});

test('the website’s menu has Sign in, and My polls once signed in', async ({ browser }, info) => {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': `site-${info.project.name}-${Date.now()}` } });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('details.menu summary').click();
  await page.locator('.menu-panel').getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.locator('.acct-who')).toBeVisible();
  await page.goto('/');
  await page.locator('details.menu summary').click();
  await expect(page.locator('.menu-panel').getByRole('link', { name: 'My polls' })).toBeVisible();
  await context.close();
});

test('a sign-in that doesn’t finish says so', async ({ page }) => {
  await page.goto('/api/auth/google/callback?code=x&state=forged');
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.locator('.acct-alert')).toHaveText('Sign-in didn’t finish. Try again.');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
});

test('saving a brand template needs an account: sign in at Save, and the draft is saved on the way back', async ({
  browser,
}, info) => {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': `brand-${info.project.name}-${Date.now()}` } });
  const page = await context.newPage();
  await page.goto('/brand');
  await page.fill('#b-name', 'Acme Inc.');
  await page.locator('#b-accent').evaluate((el) => {
    el.value = '#6d28d9';
    el.dispatchEvent(new Event('input'));
  });
  // Through the steps to the last; signed out, Save says what it needs.
  while (await page.locator('#next').isVisible()) await page.click('#next');
  await page.fill('#b-title', 'Team lunch');
  await expect(page.locator('#submit')).toHaveText('Sign in to save');
  await page.click('#submit');
  await expect(page.locator('#save-signin')).toContainText('Sign in to save your template');
  await noSideways(page);
  await audit(page, 'signing in to save a template');
  await page.locator('#save-signin').getByRole('link', { name: 'Continue with Google' }).click();

  // Back, signed in: saved as it was, with its links, and kept in the account.
  await expect(page).toHaveURL(/\/brand\/[A-Za-z0-9]+$/);
  await expect(page.locator('[data-panel="share"]')).toBeVisible();
  await expect(page.locator('#b-name')).toHaveValue('Acme Inc.');
  await expect(page.locator('#b-accent')).toHaveValue('#6d28d9');
  await expect(page.locator('#b-title')).toHaveValue('Team lunch');
  await expect(page.locator('.topbar .acct-avatar')).toBeVisible();
  await page.goto('/me');
  await page.getByRole('tab', { name: /Templates/ }).click();
  await expect(page.locator('.acct-brand .acct-row')).toContainText('Acme Inc.');
  await expect(page.locator('.acct-brand').getByRole('link', { name: 'New poll with Acme Inc.' })).toHaveAttribute(
    'href',
    /\/new\?brand=/,
  );
  // A second one, signed in now, saves straight away.
  await page.goto('/brand');
  await page.fill('#b-name', 'Beta Co');
  while (await page.locator('#next').isVisible()) await page.click('#next');
  await expect(page.locator('#submit')).toHaveText('Save template');
  await page.click('#submit');
  await expect(page.locator('[data-panel="share"]')).toBeVisible();
  await context.close();
});

test('polls answered signed in are in My polls, to search, sort and group, and the answer is yours on any device', async ({
  browser,
}, info) => {
  const who = `kit-${info.project.name}-${Date.now()}`;
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': who } });
  const page = await context.newPage();
  await page.goto('/me');
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.locator('.acct-who')).toBeVisible();
  // Nothing answered yet: it says how it fills up.
  await page.getByRole('tab', { name: 'Answered' }).click();
  await expect(page.locator('.acct-empty')).toContainText('Polls you answer while signed in show up here.');

  // Two polls someone else made, answered here while signed in.
  for (const title of ['Supper club', 'Cabin trip']) {
    const ev = await (await page.request.post('/api/events', { data: poll(title) })).json();
    await page.goto(`/e/${ev.id}`);
    await page.locator('#mine .row [data-vote="2"]').first().click();
    await page.fill('#name', 'Kit');
    await submit(page);
    await expect(page.locator('#save-err')).toBeEmpty();
  }
  await page.goto('/me');
  // The tab you were on is remembered.
  await expect(page.getByRole('tab', { name: /Answered/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /Answered/ })).toContainText('2');
  await expect(page.locator('.acct-h').first()).toContainText('Waiting on a date');
  await expect(page.locator('.acct-row')).toHaveText([/Cabin trip/, /Supper club/]);
  await expect(page.locator('.acct-row').first()).toContainText('Robin');
  await noSideways(page);
  await audit(page, 'answered');
  // Search, sort and group.
  await page.fill('#acct-q', 'supp');
  await expect(page.locator('.acct-row')).toHaveText([/Supper club/]);
  await page.fill('#acct-q', 'zzz');
  await expect(page.locator('.acct-none')).toContainText('Nothing matches');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.selectOption('#acct-sort', 'name');
  await expect(page.locator('.acct-row')).toHaveText([/Cabin trip/, /Supper club/]);
  await page.selectOption('#acct-sort', 'old');
  await expect(page.locator('.acct-row')).toHaveText([/Supper club/, /Cabin trip/]);
  await page.selectOption('#acct-group', 'none');
  await expect(page.locator('.acct-h')).toHaveCount(0);

  // Another device, signed in: the answer is theirs there too, and can be changed.
  const phone = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': who } });
  const other = await phone.newPage();
  await other.goto('/me');
  await other.getByRole('link', { name: 'Continue with Google' }).click();
  await other.getByRole('tab', { name: /Answered/ }).click();
  await other.locator('.acct-row', { hasText: 'Supper club' }).click();
  await expect(other.locator('h1')).toContainText('Supper club');
  await expect(other.locator('#name')).toHaveValue('Kit');
  await phone.close();
  await context.close();
});
