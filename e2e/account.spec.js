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
  // Let opening animations (the sheet fades in) finish, or axe measures half-faded text.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    label,
  ).toEqual([]);
}

// Sign in, signed out: in the top bar on wider screens, first in its menu on phones.
async function signIn(page) {
  const bar = page.locator('.topbar .site-signin');
  await expect(page.locator('.menu-panel .acct-group-out')).toHaveCount(1); // drawn once sign-in is known
  if (await bar.isVisible()) return bar;
  await page.getByLabel('Menu').click();
  return page.locator('.menu-panel').getByRole('link', { name: 'Sign in' });
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
  // A poll's page is for answering: no "Sign in" in its bar, only in the menu.
  await expect(page.locator('.topbar .site-signin')).toHaveCount(0);
  await page.getByLabel('Menu').click();
  await expect(page.locator('.menu-panel').getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The create page has it in the bar (in the menu on phones); it leads to My polls, with the ways to sign in.
  await page.goto('/new');
  await (await signIn(page)).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.locator('h1')).toHaveText('Sign in to Venn');
  await expect(page.locator('.acct-agree').getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  await expect(page.locator('html')).toHaveClass(/retro/);
  await noSideways(page);
  await audit(page, 'signed out');
  await page.getByRole('link', { name: 'Continue with Google' }).click();

  // Back, signed in: the remembered poll joined the account.
  await expect(page.locator('.acct-who')).toContainText('Robin Park');
  await expect(page.locator('#toast')).toHaveText('Added to My polls');
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
  // The top bar's menu has the account: their name, My polls and Sign out.
  await page.getByLabel('Menu').click();
  await expect(page.locator('.menu-who')).toHaveText('Robin Park');
  await page.locator('.menu-panel').getByRole('link', { name: 'My polls' }).click();
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
  await other.getByLabel('Menu').click();
  await other.locator('.menu-panel').getByRole('button', { name: 'Sign out' }).click();
  await expect(other.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expect(await signIn(other)).toBeVisible();
  await phone.close();

  // A poll made on another device: opening its organizer link here, signed in, adds it. No pasting.
  // (Made without this account's cookie, so it isn't kept with the account already.)
  const anon = await browser.newContext();
  const elsewhere = await (await anon.request.post('/api/events', { data: poll('Cabin trip') })).json();
  await page.goto(`/e/${elsewhere.id}#admin=${elsewhere.adminToken}`);
  await expect(page.locator('#toast')).toHaveText('Added to My polls');
  await page.goto('/me');
  await expect(page.locator('.acct-row')).toHaveCount(3);
  // A guest's link adds nothing.
  const theirs = await (await anon.request.post('/api/events', { data: poll('Pub quiz') })).json();
  await anon.close();
  await page.goto(`/e/${theirs.id}`);
  await page.goto('/me');
  await expect(page.locator('.acct-row')).toHaveCount(3);

  // "Missing a poll?" says how polls get here, and pasting the link is the last resort.
  await page.getByRole('button', { name: 'Missing a poll?' }).click();
  const sheet = page.locator('#acct-sheet');
  await expect(sheet).toContainText('Sign in to Venn there');
  await sheet.getByLabel('Or paste the link here').fill(`${ACCOUNTS_URL}/e/${theirs.id}`);
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sheet.locator('#acct-paste-msg')).toContainText('the poll’s link for guests');
  await noSideways(page);
  await audit(page, 'missing a poll');
  await sheet.getByLabel('Or paste the link here').fill(`${ACCOUNTS_URL}/e/${theirs.id}#admin=${theirs.adminToken}`);
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Added to My polls');
  await expect(page.locator('.acct-row')).toHaveCount(4);

  // Deleting the account is in Account settings, and asks twice; the polls stay, with their links.
  await page.getByRole('link', { name: 'Account settings' }).click();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('button', { name: 'Yes, delete my account' }).click();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await page.goto(`/e/${made.id}`);
  await expect(page.locator('h1')).toContainText('Supper club');
  await context.close();
});

test('the website: Sign in after Create a Venn (in the menu on phones), then the account in the menu', async ({
  browser,
}, info) => {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': `site-${info.project.name}-${Date.now()}` } });
  const page = await context.newPage();
  await page.goto('/');
  const phone = page.viewportSize().width < 480;
  const nav = page.getByRole('navigation', { name: 'Main' });
  const panel = page.locator('.menu-panel');
  const menu = page.locator('details.menu summary');
  // Create a Venn stays the main button, first in the bar; the whole bar fits on a phone.
  await expect(nav.locator(':scope > *').first()).toHaveText('Create a Venn');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Sign in: plain text in the bar on wider screens; on phones, nothing more in the bar, and first
  // in the menu.
  const inBar = nav.locator(':scope > a', { hasText: 'Sign in' });
  if (phone) {
    await expect(inBar).toBeHidden();
    await menu.click();
    await expect(panel.locator('a').first()).toHaveText('Sign in');
    await panel.getByRole('link', { name: 'Sign in' }).click();
  } else {
    await expect(inBar).toBeVisible();
    const box = await inBar.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    await menu.click();
    await expect(panel.getByRole('link', { name: 'Sign in' })).toBeHidden();
    await menu.click();
    await inBar.click();
  }
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.locator('.acct-who')).toBeVisible();
  await page.goto('/');
  await expect(nav.locator('.site-signin')).toHaveCount(0);
  await menu.click();
  await expect(panel.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'My polls' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Account settings' })).toHaveAttribute('href', '/me/settings');
  await panel.getByRole('button', { name: 'Sign out' }).click();
  await expect(panel).toBeHidden();
  await menu.click();
  await expect(panel.getByRole('link', { name: 'My polls' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Sign in' })).toBeVisible({ visible: phone });
  await context.close();
});

test('the sign-in page shows at once on a second visit, with no stand-in first', async ({ page }) => {
  await page.goto('/me');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  // Again, with the server slow to answer: the page is there before it does.
  await page.route('**/api/me', async (r) => {
    await new Promise((done) => setTimeout(done, 1500));
    await r.continue();
  });
  await page.goto('/me');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible({ timeout: 1000 });
  await expect(page.locator('h1')).toHaveText('Sign in to Venn');
  await expect(page.locator('.acct-skeleton')).toHaveCount(0);
});

test('back from Google with the server slow to answer: My polls loading, never the sign-in page again', async ({
  browser,
}, info) => {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': `slow-${info.project.name}-${Date.now()}` } });
  const page = await context.newPage();
  await page.goto('/me'); // remembers the ways in, so the sign-in page would show at once
  await page.route('**/api/me', async (r) => {
    await new Promise((done) => setTimeout(done, 1500));
    await r.continue();
  });
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/me$/); // the #signed-in marker is gone from the address bar
  await expect(page.locator('.acct-skeleton')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.locator('.acct-who')).toBeVisible();
  await context.close();
});

test('a sign-in that doesn’t finish says so', async ({ page }) => {
  await page.goto('/api/auth/google/callback?code=x&state=forged');
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.locator('.acct-alert')).toHaveText('Sign-in didn’t finish. Try again.');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
});

test('For organizations needs an account: sign in first, then make a template; a draft survives a session ending', async ({
  browser,
}, info) => {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': `brand-${info.project.name}-${Date.now()}` } });
  const page = await context.newPage();
  // Signed out, For organizations shows what a template is, and asks to sign in to make one.
  await page.goto('/brand');
  await expect(page.locator('h1')).toHaveText('Your brand on every poll');
  await page.getByRole('link', { name: 'Sign in to make yours' }).click();
  await expect(page).toHaveURL(/\/brand\/new$/);
  await expect(page.locator('h1')).toHaveText('Sign in to make your template');
  await expect(page.locator('#brand-form')).toHaveCount(0);
  await noSideways(page);
  await audit(page, 'signing in to make a template');
  await page.getByRole('link', { name: 'Continue with Google' }).click();

  // Back, signed in: the editor, and saving keeps it in the account.
  await expect(page).toHaveURL(/\/brand\/new$/);
  await page.fill('#b-name', 'Acme Inc.');
  await page.locator('#b-accent').evaluate((el) => {
    el.value = '#6d28d9';
    el.dispatchEvent(new Event('input'));
  });
  while (await page.locator('#next').isVisible()) await page.click('#next');
  await page.fill('#b-title', 'Team lunch');
  await expect(page.locator('#submit')).toHaveText('Save template');
  await page.click('#submit');
  await expect(page).toHaveURL(/\/brand\/[A-Za-z0-9]+$/);
  await expect(page.locator('[data-panel="share"]')).toBeVisible();
  await expect(page.locator('#b-name')).toHaveValue('Acme Inc.');
  await expect(page.locator('#b-accent')).toHaveValue('#6d28d9');
  await page.goto('/me');
  await page.getByRole('tab', { name: /Templates/ }).click();
  // Venn's own Retro and Classic are always there, above the account's own, to duplicate.
  await expect(page.locator('.acct-brand .acct-row b')).toHaveText(['Retro', 'Classic', 'Acme Inc.']);
  await expect(page.locator('.acct-brand').getByRole('link', { name: 'New poll with Acme Inc.' })).toHaveAttribute(
    'href',
    /\/new\?brand=/,
  );
  // Duplicating Retro starts a new template in its colours and headings, to make it yours.
  await page.getByRole('link', { name: 'Duplicate Retro' }).click();
  await expect(page).toHaveURL(/\/brand\/new\?look=retro$/);
  await expect(page.locator('#b-accent')).toHaveValue('#2de2e6');
  await expect(page.locator('#b-bg')).toHaveValue('#0d0221');
  await expect(page.locator('[data-font="retro"]')).toHaveAttribute('aria-checked', 'true');
  await noSideways(page);

  // A new poll's page has no look picker: the template's own New poll gives its look.
  await page.goto('/new');
  await expect(page.getByRole('radiogroup', { name: 'Look' })).toHaveCount(0);
  await expect(page.locator('.footer .classic-switch')).toBeVisible();
  await page.goto('/me');
  await page.getByRole('tab', { name: /Templates/ }).click();
  await page.getByRole('link', { name: 'New poll with Acme Inc.' }).click();
  await expect(page.locator('#create .brand-bar')).toHaveText('Acme Inc.');
  await expect(page.locator('.footer .classic-switch')).toBeHidden();
  await noSideways(page);
  await audit(page, 'a poll from a template');
  await page.fill('#organizer', 'Robin');
  await pickDays(page, 2);
  await page.fill('#notify', 'robin@example.com');
  await page.click('#submit');
  await expect(page.locator('.party [role=status]')).toContainText('Your Venn is ready!');
  await page.locator('.party-go').click();
  await expect(page).toHaveURL(/\/e\/[A-Za-z0-9]+$/);
  await expect(page.locator('.brand-bar')).toHaveText('Acme Inc.');

  // A second one, whose session ends while it's made: Save asks to sign in, and the draft is saved
  // on the way back.
  await page.goto('/brand/new');
  await page.fill('#b-name', 'Beta Co');
  await context.clearCookies();
  while (await page.locator('#next').isVisible()) await page.click('#next');
  await page.fill('#b-title', 'Book club');
  await page.click('#submit');
  await expect(page.locator('#save-signin')).toContainText('Sign in to save your template');
  await noSideways(page);
  await audit(page, 'signing in to save a template');
  await page.locator('#save-signin').getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/brand\/[A-Za-z0-9]+$/);
  await expect(page.locator('[data-panel="share"]')).toBeVisible();
  await expect(page.locator('#b-name')).toHaveValue('Beta Co');
  await expect(page.locator('#b-title')).toHaveValue('Book club');
  await context.close();
});

test('sharing a template: an admin invite lets them change it, a user invite adds it to their templates', async ({
  browser,
}, info) => {
  const run = `${info.project.name}-${Date.now()}`;
  const signedIn = async (who) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { 'x-test-user': who },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    return { context, page };
  };
  const signIn = async (page) => {
    await page.goto('/me');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await expect(page.locator('.acct-who')).toBeVisible();
  };
  // The owner makes a template, and copies a user invite from its Share step.
  const owner = await signedIn(`owner-${run}`);
  await signIn(owner.page);
  const made = await (await owner.page.request.post('/api/brands', { data: { name: 'Northwind', accent: '#1d4ed8' } })).json();
  await owner.page.goto(`/brand/${made.id}#organizer`);
  const share = owner.page.locator('#b-sharing');
  await expect(share.getByRole('heading', { name: 'Share it' })).toBeVisible();
  await expect(share).toContainText('Nobody else has it yet.');
  await share.getByRole('button', { name: 'Copy link to use' }).click();
  await expect(owner.page.locator('#toast')).toHaveText('Link copied. Whoever opens it can use this template.');
  const invite = await owner.page.evaluate(() => navigator.clipboard.readText());
  expect(invite).toMatch(new RegExp(`/brand/${made.id}#join=[A-Za-z0-9]+$`));
  await expect(share).toContainText('1 invite link works');
  // The same link again, not a new one.
  await share.getByRole('button', { name: 'Copy link to use' }).click();
  expect(await owner.page.evaluate(() => navigator.clipboard.readText())).toBe(invite);
  await expect(share).toContainText('1 invite link works');

  // Someone opens it signed out: sign in, and it's in their templates, to use but not change.
  const guest = await signedIn(`member-${run}`);
  await guest.page.goto(invite.replace(/^https?:\/\/[^/]+/, ''));
  await expect(guest.page.locator('h1')).toHaveText('Sign in to add Northwind’s template');
  await noSideways(guest.page);
  await audit(guest.page, 'signing in to join a template');
  await guest.page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(guest.page).toHaveURL(new RegExp(`/brand/${made.id}$`));
  await expect(guest.page.locator('#toast')).toHaveText('Added to your templates.');
  await expect(guest.page.locator('h1')).toHaveText('Northwind’s template');
  await expect(guest.page.getByText('In your templates, to make polls with. Its owner can change it.')).toBeVisible();
  await expect(guest.page.locator('#brand-form')).toHaveCount(0);
  await noSideways(guest.page);
  await audit(guest.page, 'a template shared as a user');
  await guest.page.goto('/me');
  await guest.page.getByRole('tab', { name: /Templates/ }).click();
  await expect(guest.page.locator('.acct-brand', { hasText: 'Northwind' })).toContainText('Shared with you · Can use');
  await expect(guest.page.getByRole('link', { name: 'New poll with Northwind' })).toHaveAttribute('href', /\/new\?brand=/);

  // The owner sees them, and makes them an admin: now they can change it.
  await owner.page.reload();
  await expect(share.locator('.member')).toHaveCount(1);
  await share.getByRole('combobox', { name: 'What Robin Park can do' }).selectOption('admin');
  await expect(owner.page.locator('#toast')).toHaveText('They can change it now.');
  await noSideways(owner.page);
  await audit(owner.page, 'sharing a template');
  await guest.page.goto(`/brand/${made.id}#organizer`);
  await expect(guest.page.locator('#brand-form')).toBeVisible();
  await expect(guest.page.locator('[data-panel="share"]')).toContainText('Shared with you to edit');
  await expect(guest.page.locator('#b-sharing')).toHaveCount(0);
  await expect(guest.page.locator('#b-delete')).toHaveCount(0);
  // They leave it: it's off their templates.
  await guest.page.locator('#b-leave').click();
  await expect(guest.page).toHaveURL(/\/me$/);
  await guest.page.getByRole('tab', { name: /Templates/ }).click();
  await expect(guest.page.locator('.acct-brand', { hasText: 'Northwind' })).toHaveCount(0);
  // Pasting the invite in "Missing a template?" adds it back, staying on My polls.
  await guest.page.getByRole('button', { name: 'Missing a template?' }).click();
  await guest.page.getByLabel('Or paste the link here').fill(invite);
  await guest.page.locator('#acct-sheet').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(guest.page.locator('#toast')).toHaveText('Added to your templates');
  await expect(guest.page.locator('.acct-brand', { hasText: 'Northwind' })).toHaveCount(1);

  // Turning the invite links off: the link no longer works.
  await owner.page.reload();
  await share.getByRole('button', { name: 'Turn them off' }).click();
  await expect(owner.page.locator('#toast')).toHaveText('Invite links turned off. Everyone who joined keeps it.');
  await guest.page.goto(invite.replace(/^https?:\/\/[^/]+/, ''));
  await expect(guest.page.locator('#toast')).toHaveText('This invite link was turned off. Ask for a new one.');
  await owner.context.close();
  await guest.context.close();
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
    // This Venn sends email (for email sign-in), so the answer offers a copy by email.
    await page.fill('#copy-to', 'kit@example.com');
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
  // Sort and group: one button, one sheet, applied as it's tapped.
  await page.locator('#acct-sortbtn').click();
  const sheet = page.locator('#acct-sheet');
  await expect(sheet).toBeVisible();
  await audit(page, 'sort sheet');
  await sheet.getByRole('radio', { name: /Name/ }).click();
  await expect(page.locator('.acct-row')).toHaveText([/Cabin trip/, /Supper club/]);
  await sheet.getByRole('radio', { name: /Oldest/ }).click();
  await expect(page.locator('.acct-row')).toHaveText([/Supper club/, /Cabin trip/]);
  await sheet.getByRole('radio', { name: 'None' }).click();
  await expect(page.locator('.acct-h')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('#acct-sortbtn')).toHaveText('Oldest');
  // ⋯ on an answered poll: take it off the list (the answer stays).
  await page.getByRole('button', { name: 'Manage Cabin trip' }).click();
  await sheet.getByRole('button', { name: 'Remove from My polls' }).click();
  await expect(page.locator('#toast')).toHaveText('Removed from My polls');
  await expect(page.locator('.acct-row')).toHaveText([/Supper club/]);
  await expect(page.getByRole('tab', { name: /Answered/ })).toContainText('1');

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

test('a long list shows a few at a time, and ⋯ manages a poll: copy, remind, delete', async ({ browser }, info) => {
  const who = `many-${info.project.name}-${Date.now()}`;
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': who } });
  const page = await context.newPage();
  await page.goto('/me');
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.locator('.acct-who')).toBeVisible();
  // Eight waiting on a date, and three whose date has passed, all made signed in.
  const ids = [];
  for (let i = 1; i <= 11; i++) {
    const p = poll(`Poll ${i}`);
    const ev = await (await page.request.post('/api/events', { data: i > 8 ? { ...p, dates: ['2024-03-03'] } : p })).json();
    ids.push(ev);
    if (i > 8) {
      const { slots } = await (await page.request.get(`/api/events/${ev.id}`)).json();
      await page.request.post(`/api/events/${ev.id}/finalize`, {
        headers: { 'x-admin-token': ev.adminToken },
        data: { start: slots[0] },
      });
    }
  }
  await page.goto('/me');
  await page.getByRole('tab', { name: /Created/ }).click();
  // Five of the eight, then Show more; Past folded.
  await expect(page.locator('.acct-row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Show 3 more' }).click();
  await expect(page.locator('.acct-row')).toHaveCount(8);
  await expect(page.locator(':focus')).toContainText('Poll 3');
  await page.getByRole('button', { name: /Past/ }).click();
  await expect(page.locator('.acct-row')).toHaveCount(11);
  // Searching shows every match.
  await page.fill('#acct-q', 'poll 1');
  await expect(page.locator('.acct-row')).toHaveCount(3);
  await page.fill('#acct-q', '');
  await noSideways(page);
  await audit(page, 'long list');

  // ⋯: delete asks first, in the sheet.
  const sheet = page.locator('#acct-sheet');
  await page.getByRole('button', { name: 'Manage Poll 8' }).click();
  await expect(sheet.getByRole('button', { name: 'Remind the group' })).toBeVisible();
  await audit(page, 'poll sheet');
  await sheet.getByRole('button', { name: 'Delete poll' }).click();
  await expect(sheet).toContainText('Delete “Poll 8”?');
  await sheet.getByRole('button', { name: 'Keep it' }).click();
  await sheet.getByRole('button', { name: 'Delete poll' }).click();
  await sheet.locator('[data-act="delete-yes"]').click();
  await expect(page.locator('#toast')).toHaveText('Poll deleted');
  await expect(page.getByRole('tab', { name: /Created/ })).toContainText('10');
  expect((await page.request.get(`/api/events/${ids[7].id}`)).status()).toBe(404);
  // A picked poll has nobody to remind.
  await page.getByRole('button', { name: 'Manage Poll 9' }).click();
  await expect(sheet.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Remind the group' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  await context.close();
});
