import { test, expect } from '@playwright/test';
import { ACCOUNTS_URL } from '../playwright.config.js';

// Deadlines and reminders come with an account, where the server has sign-in (src/deadline.js):
// signed out, the create forms stay as they are, and the organizer's Deadline panel says to sign in.
// Signed in, a vote (or a date poll) can close answers and remind who hasn't answered.
test.use({ baseURL: ACCOUNTS_URL });

const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: false });

test('signed out, no deadline on the form; signed in, a vote closes answers and reminds', async ({ browser }, info) => {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': `dl-${info.project.name}-${Date.now()}` } });
  const page = await context.newPage();
  const size = info.project.name === 'mobile' ? 'phone' : 'desktop';

  // Signed out: the form is as it was, with no Deadline row.
  await page.goto('/new/topic');
  await expect(page.getByLabel("What's it called?")).toBeVisible();
  await expect(page.locator('#deadline-opts')).toBeHidden();
  // A poll's organizer, signed out: Deadline says to sign in, and nothing else.
  const made = await (
    await page.request.post('/api/events', {
      data: {
        title: 'Where should we eat?',
        organizer: 'Priya',
        timezone: 'Europe/London',
        mode: 'topic',
        options: [{ label: "Rosa's" }, { label: 'Taco Loco' }],
      },
    })
  ).json();
  await page.goto(`/e/${made.id}#admin=${made.adminToken}`);
  await page.locator('details.organizer summary').click();
  await page.click('#deadline-open');
  await expect(page.locator('#deadline-body')).toHaveText(/Sign in to close answers on a set day/);
  await expect(page.locator('#dl-at')).toHaveCount(0);
  await shot(page, `${size}-signed-out-panel`);

  // Signed in: the Deadline row is on the vote form.
  await page.goto('/me');
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.locator('.acct-who')).toBeVisible();
  await page.goto('/new/topic');
  await page.getByLabel("What's it called?").fill('Which book next?');
  await page.getByLabel('Option 1', { exact: true }).fill('Dune');
  await page.getByLabel('Option 2', { exact: true }).fill('Emma');
  await page.getByLabel(/Your name/).fill('Priya');
  if (await page.locator('#notify').isVisible()) await page.locator('#notify').fill('priya@example.com');
  await expect(page.locator('#deadline-opts')).toBeVisible();
  // This Venn sends email: who to email it to, and (with a deadline) how often to remind them.
  await page.locator('#invite-opts summary').click();
  await page.locator('#inv-input').fill('ana@example.com, lee@example.com ');
  await expect(page.locator('#p-email')).toBeChecked(); // reminders need to know who answered
  await page.locator('#deadline-opts summary').click();
  await page.getByRole('button', { name: 'In 3 days' }).click();
  await expect(page.getByRole('button', { name: 'In 3 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#dl-at')).toHaveValue(/T18:00$/);
  await expect(page.getByLabel(/Remind who hasn/)).toBeVisible();
  await page.locator('#deadline-opts').scrollIntoViewIfNeeded();
  await shot(page, `${size}-create-deadline`);
  await page.click('#submit');
  await page.locator('.party-go').click();
  await page.locator('.party').waitFor({ state: 'detached' });
  await expect(page).toHaveURL(/\/e\/\w+$/);
  const id = page.url().split('/e/')[1];

  // Guests see when answers close, and are asked for their email.
  const guest = await browser.newContext();
  const g = await guest.newPage();
  await g.goto(`/e/${id}`);
  await expect(g.locator('.deadline-line')).toContainText(/Answers close .*6:00/);
  await expect(g.locator('#email')).toBeVisible();
  await shot(g, `${size}-guest-closes`);
  // After the deadline, the vote is closed to guests.
  await g.clock.setFixedTime(new Date(Date.now() + 4 * 86_400_000));
  await g.reload();
  await expect(g.locator('.deadline-line')).toContainText('Answers closed');
  await expect(g.locator('#save')).toBeDisabled();
  await expect(g.locator('#save-state')).toHaveText('Answers are closed. Priya is picking one.');
  await guest.close();

  // My polls says when it closes; ⋯ goes straight to the Deadline panel.
  await page.goto('/me');
  const row = page.locator('.acct-item', { hasText: 'Which book next?' });
  await expect(row).toContainText(/Vote · Closes /);
  await row.getByRole('button', { name: 'Manage Which book next?' }).click();
  await shot(page, `${size}-mypolls-menu`);
  await page.getByRole('link', { name: 'Change the deadline' }).click();
  await expect(page.locator('#deadline-h')).toBeVisible();
  await expect(page.locator('#dl-hint')).toHaveText(/the 2 people you emailed it to/);
  await page.locator('#deadline-box').scrollIntoViewIfNeeded();
  await shot(page, `${size}-organizer-panel`);
  await context.close();
});
