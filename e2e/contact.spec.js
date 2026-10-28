import { test, expect } from '@playwright/test';
import { mockContact } from './helpers.js';

test('the home page takes feature requests and messages, with an email to reply to', async ({ page }) => {
  const sent = await mockContact(page);
  await page.goto('/#contact');
  const form = page.locator('.contact-form');
  await expect(form).toBeVisible();

  // A feature request: the email is optional.
  await expect(page.getByLabel('Request a feature')).toBeChecked();
  await page.getByLabel('Your idea').fill('Recurring polls, please');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toHaveText('Thanks for the idea!');
  expect(sent).toEqual([{ kind: 'feature', message: 'Recurring polls, please', email: '', website: '' }]);
  await expect(page.getByLabel('Your idea')).toHaveValue('');

  // "Contact us" needs an email, so the reply has somewhere to go.
  await page.getByText('Contact us', { exact: true }).click();
  await expect(page.getByText('(so we can reply)')).toBeVisible();
  await page.getByLabel('Your message').fill('Can I host my own Venn?');
  await page.getByRole('button', { name: 'Send' }).click();
  expect(sent).toHaveLength(1);
  await page.getByLabel(/Your email/).fill('ana@example.com');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toHaveText(/get back to you/);
  expect(sent[1]).toEqual({ kind: 'contact', message: 'Can I host my own Venn?', email: 'ana@example.com', website: '' });

  // The footer links here from every page.
  await page.goto('/privacy');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Contact' }).click();
  await expect(page).toHaveURL(/\/#contact$/);
  await expect(form).toBeInViewport();
});

test('when sending fails, the form says why and keeps the message', async ({ page }) => {
  await mockContact(page, { status: 429, json: { error: "That's a few messages already. Try again in an hour." } });
  await page.goto('/');
  await page.getByLabel('Your idea').fill('Dark mode');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toHaveText(/Try again in an hour/);
  await expect(page.getByLabel('Your idea')).toHaveValue('Dark mode');
});

test('without email set up there is no form, only the GitHub link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ideas and questions' })).toBeVisible();
  await expect(page.locator('.contact-form')).toBeHidden();
  await expect(page.getByRole('link', { name: 'open an issue on GitHub' })).toBeVisible();
});
