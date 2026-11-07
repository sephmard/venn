import { test, expect } from '@playwright/test';
import { ACCOUNTS_URL, FAKE_OAUTH_URL } from '../playwright.config.js';

// Emailing a poll to people (src/invites.js), signed in: paste a whole list on the create page,
// Venn emails each person once the poll is made, and the organizer adds more from Invite by email.
test.use({ baseURL: ACCOUNTS_URL });

const shot = (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: false });

test('paste a list, the poll is emailed to each, more can be added later', async ({ browser }, info) => {
  const tag = `${info.project.name}${Date.now()}`;
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': `inv-${tag}` } });
  const page = await context.newPage();
  const size = info.project.name === 'mobile' ? 'phone' : 'desktop';
  const mail = (who) => `${who}.${tag}@example.com`;
  const outbox = async (to) => (await page.request.get(`${FAKE_OAUTH_URL}/outbox?to=${encodeURIComponent(to)}`)).json();

  // Signed out: no row for it.
  await page.goto('/new/topic');
  await expect(page.getByLabel("What's it called?")).toBeVisible();
  await expect(page.locator('#invite-opts')).toBeHidden();

  await page.goto('/me');
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.locator('.acct-who')).toBeVisible();
  await page.goto('/new/topic');
  await page.getByLabel("What's it called?").fill('Which book next?');
  await page.getByLabel('Option 1', { exact: true }).fill('Dune');
  await page.getByLabel('Option 2', { exact: true }).fill('Emma');
  await page.getByLabel(/Your name/).fill('Priya');
  if (await page.locator('#notify').isVisible()) await page.locator('#notify').fill('priya@example.com');

  // A pasted list: names, repeats and a typo. The emails become chips; the typo stays to fix.
  await page.locator('#invite-opts summary').click();
  const box = page.locator('#inv-input');
  await box.focus();
  await page.evaluate(
    (text) => {
      const el = document.querySelector('#inv-input');
      el.value = text;
      el.dispatchEvent(new ClipboardEvent('paste'));
    },
    `Ana Silva <${mail('ana')}>, ${mail('lee')}\n${mail('kim')}; ${mail('ana')} bob@`,
  );
  await expect(page.locator('.inv-chip')).toHaveCount(3);
  await expect(page.locator('#inv-note')).toHaveText('3 people · 1 already on the list · Check this: bob@');
  await expect(box).toHaveValue('bob@');
  await expect(page.locator('#p-email')).toBeChecked();
  await page.locator('#invite-opts').scrollIntoViewIfNeeded();
  await shot(page, `${size}-1-create-pasted`);
  // Creating with the typo still there says so.
  await page.click('#submit');
  await expect(page.locator('#err')).toHaveText(/Check the emails/);
  await box.fill(`${mail('bo')} `);
  await expect(page.locator('.inv-chip')).toHaveCount(4);
  // A chip comes off with its ×.
  await page.getByRole('button', { name: `Remove ${mail('kim')}` }).click();
  await expect(page.locator('.inv-chip')).toHaveCount(3);
  await page.click('#submit');
  await page.locator('.party-go').click();
  await page.locator('.party').waitFor({ state: 'detached' });
  await expect(page).toHaveURL(/\/e\/\w+$/);

  // Each got the poll, from Priya, with a link that fills in their email.
  await expect.poll(async () => (await outbox(mail('ana'))).length).toBe(1);
  const [invite] = await outbox(mail('ana'));
  expect(invite.subject).toBe('Priya wants your vote: “Which book next?”');
  expect(await outbox(mail('kim'))).toHaveLength(0);
  const link = invite.text.match(/https?:\/\/\S+#invited=\S+/)[0];
  const guest = await browser.newContext();
  const g = await guest.newPage();
  await g.goto(link.replace(/^https?:\/\/[^/]+/, ACCOUNTS_URL));
  await expect(g.locator('#email')).toHaveValue(mail('ana')); // a vote's email field
  await guest.close();

  // Invite by email, in organizer tools: who has it, and more added.
  await page.locator('details.organizer summary').click();
  await page.click('#invite-open');
  await expect(page.locator('#invitee-list li')).toHaveCount(3);
  await expect(page.locator('#invitee-list li').first()).toContainText('Emailed');
  await page.locator('#inv-input').fill(`${mail('kim')}, ${mail('ana')} `);
  await expect(page.locator('#inv-note')).toContainText('1 already on the list');
  await expect(page.locator('#invite-send')).toHaveText('Send to 1 person');
  await page.locator('#invite-box').scrollIntoViewIfNeeded();
  await shot(page, `${size}-2-organizer-panel`);
  await page.click('#invite-send');
  await expect(page.locator('#invitee-list li')).toHaveCount(4);
  await expect.poll(async () => (await outbox(mail('kim'))).length).toBe(1);
  expect(await outbox(mail('ana'))).toHaveLength(1); // not again

  // My polls: ⋯ goes straight to it.
  await page.goto('/me');
  await page
    .locator('.acct-item', { hasText: 'Which book next?' })
    .getByRole('button', { name: 'Manage Which book next?' })
    .click();
  await shot(page, `${size}-3-mypolls-menu`);
  await page.getByRole('link', { name: 'Invite more by email' }).click();
  await expect(page.locator('#invite-h')).toBeVisible();

  // A date poll's invitation link fills in the email the same way.
  const start = Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 5 * 86_400_000;
  const made = await (
    await page.request.post('/api/events', {
      data: {
        title: 'Dinner',
        organizer: 'Priya',
        timezone: 'UTC',
        mode: 'options',
        options: [{ start, end: start + 3_600_000 }],
      },
    })
  ).json();
  const g2 = await (await browser.newContext()).newPage();
  await g2.goto(`/e/${made.id}#invited=${encodeURIComponent(mail('lee'))}`);
  await expect(g2.locator('#copy-to')).toHaveValue(mail('lee'));
  await context.close();
});
