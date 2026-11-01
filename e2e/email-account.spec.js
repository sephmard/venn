import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ACCOUNTS_URL, FAKE_OAUTH_URL } from '../playwright.config.js';

// Signing in with an email and a password, the whole way round: sign up, the emailed link, Account
// settings, a forgotten password. Emails go to a stand-in for Resend (e2e/fake-oauth.js).
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

/** The link in the last email to `to`. */
async function emailedLink(page, to) {
  let link;
  await expect
    .poll(async () => {
      const mails = await (await page.request.get(`${FAKE_OAUTH_URL}/outbox?to=${encodeURIComponent(to)}`)).json();
      link = mails.at(-1)?.text.match(/https?:\/\/\S+#t=[\w-]{43}/)?.[0];
      return link;
    })
    .toBeTruthy();
  return link;
}

test('an account with an email: sign up, confirm, change the password, forget it, reset it', async ({ page }, info) => {
  const email = `ana-${info.project.name}-${Date.now()}@example.com`.toLowerCase();
  await page.goto('/me');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await noSideways(page);
  await audit(page, 'sign in');

  // Create an account: then "check your inbox".
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#em-error')).toHaveText('Use at least 10 characters');
  await page.getByLabel('Password', { exact: true }).fill('tangerine-kayak-41');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('.em-sent')).toContainText(`We sent a link to ${email}`);
  await noSideways(page);

  // The link opens a page that asks for a tap, then signs in.
  await page.goto(await emailedLink(page, email));
  await expect(page).toHaveURL(/\/me\/confirm$/); // the secret is out of the address bar
  await audit(page, 'confirm');
  await page.getByRole('button', { name: 'Confirm and sign in' }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.locator('#toast')).toHaveText('Welcome to Venn');
  await expect(page.locator('.acct-who')).toContainText(email);

  // Account settings: change the password.
  await page.getByRole('link', { name: 'Account settings' }).click();
  await expect(page.locator('h1')).toHaveText('Account settings');
  await expect(page.locator('.set-row').first()).toContainText(email);
  await noSideways(page);
  await audit(page, 'settings');
  await page.locator('[data-open="password"]').click();
  await page.getByLabel('Current password').fill('nope-nope-nope');
  await page.getByLabel('New password').fill('brand-new-secret-5');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.locator('#set-password-error')).toHaveText('That’s not your current password');
  await page.getByLabel('Current password').fill('tangerine-kayak-41');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.locator('#toast')).toHaveText('Password changed. Other devices were signed out.');

  // Sign out, and the password is forgotten.
  await page.locator('#set-signout').click();
  await expect(page).toHaveURL(/\/me$/);
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.locator('.em-sent')).toContainText(email);
  await page.goto(await emailedLink(page, email));
  await expect(page.locator('h1')).toHaveText('Choose a new password');
  await audit(page, 'reset');
  await page.getByLabel('New password').fill('third-time-lucky-8');
  await page.getByRole('button', { name: 'Save password' }).click();

  // Then sign in with it, the email filled in.
  await expect(page.locator('h1')).toHaveText('Password saved');
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByLabel('Password', { exact: true }).fill('brand-new-secret-5');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#em-error')).toContainText('don’t match');
  await page.getByLabel('Password', { exact: true }).fill('third-time-lucky-8');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.locator('.acct-who')).toContainText(email);

  // A used link says so.
  await page.goto('/me/confirm#t=' + 'a'.repeat(43));
  await page.getByRole('button', { name: 'Confirm and sign in' }).click();
  await expect(page.locator('h1')).toHaveText('This link has expired');
});
