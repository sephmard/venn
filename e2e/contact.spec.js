import { test, expect } from '@playwright/test';
import { mockContact } from './helpers.js';

test('the home page takes feature requests and messages, with an email to reply to', { tag: '@site' }, async ({ page }) => {
  const sent = await mockContact(page);
  await page.goto('/');
  // Ideas & questions: Contact, in the menu and the footer, opens them in a dialog (no button in the corner).
  const dialog = page.getByRole('dialog', { name: 'Ideas and questions' });
  await expect(dialog).toBeHidden();
  await page.locator('footer').getByRole('link', { name: 'Contact' }).click();
  await expect(dialog).toBeVisible();
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

  // Escape closes it.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // The footer links here from every page, and the link opens the dialog; closed, it stays closed on a reload.
  await page.goto('/privacy');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Contact' }).click();
  await expect(page).toHaveURL(/\/#contact$/);
  await expect(dialog).toBeVisible();
  await expect(form).toBeInViewport();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  // On the home page, the footer's Contact link opens it too.
  await page.getByRole('contentinfo').getByRole('link', { name: 'Contact' }).click();
  await expect(dialog).toBeVisible();
});

test('when sending fails, the form says why and keeps the message', { tag: '@site' }, async ({ page }) => {
  await mockContact(page, { status: 429, json: { error: "That's a few messages already. Try again in an hour." } });
  await page.goto('/#contact');
  await page.getByLabel('Your idea').fill('Dark mode');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toHaveText(/Try again in an hour/);
  await expect(page.getByLabel('Your idea')).toHaveValue('Dark mode');
});

test('without email set up there is no form, only the GitHub link', { tag: '@site' }, async ({ page }) => {
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'Contact' }).click();
  await expect(page.getByRole('heading', { name: 'Ideas and questions' })).toBeVisible();
  await expect(page.locator('.contact-form')).toBeHidden();
  await expect(page.getByRole('link', { name: 'open an issue on GitHub' })).toBeVisible();
});
