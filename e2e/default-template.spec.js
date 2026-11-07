import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ACCOUNTS_URL, FAKE_OAUTH_URL } from '../playwright.config.js';

// A signed-in account's default templates (sprint D): the brand template its new date polls start
// in, and the one its votes start in. Set in My polls › Templates or on the template's page; a
// template link, a draft being picked up, or "Use no template" for one poll comes first. On a Venn
// with sign-in switched on (ACCOUNTS_URL).
test.use({ baseURL: ACCOUNTS_URL });

async function noBlockingA11y(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking,
    `${label}\n${blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n')}`,
  ).toEqual([]);
}
const noSideways = async (page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);

/** A signed-in browser (the test sign-in, e2e/fake-oauth.js) with templates of its own: { page, ids }. */
async function signedIn(browser, info, names) {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-test-user': `defaults-${info.project.name}-${Date.now()}` },
  });
  const page = await context.newPage();
  await page.goto('/me');
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'My polls' })).toBeVisible();
  const ids = {};
  for (const [name, more] of Object.entries(names))
    ids[name] = (await (await page.request.post('/api/brands', { data: { name, ...more } })).json()).id;
  await page.reload();
  return { page, context, ids };
}

const created = (page) =>
  page
    .waitForResponse((r) => r.request().method() === 'POST' && /\/api\/events$/.test(r.url()))
    .then((r) => r.request().postDataJSON());

test('a default for date polls: set in My polls, used by /new, and not by votes', async ({ browser }, info) => {
  test.slow();
  const { page, ids } = await signedIn(browser, info, { Acme: { title: 'Team lunch', where: 'The canteen' }, 'Book club': {} });
  await page.getByRole('tab', { name: /Templates/ }).click();
  const date = page.getByLabel('Date polls start with');
  const vote = page.getByLabel('Votes start with');
  await expect(date).toHaveValue('');
  await expect(vote).toHaveValue('');
  expect((await date.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await date.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  await date.selectOption({ label: 'Acme' });
  await expect(page.locator('#toast')).toHaveText('New date polls start with Acme.');
  await expect(page.locator('.acct-brand', { hasText: 'Acme' }).locator('.muted')).toContainText('Default for date polls');
  await expect(page.getByLabel('Date polls start with')).toBeFocused();
  // Not saved (the connection drops): the select goes back, and the page says so.
  await page.route('**/api/me/defaults', (r) => (r.request().method() === 'PUT' ? r.abort() : r.continue()));
  await page.getByLabel('Votes start with').selectOption({ label: 'Book club' });
  await expect(page.locator('#def-err')).toHaveText("Couldn't save that. Try again.");
  await expect(page.getByLabel('Votes start with')).toHaveValue('');
  await page.unroute('**/api/me/defaults');
  await noSideways(page);
  await noBlockingA11y(page, 'My polls, Templates, with defaults');

  // Kept on the server: another browser signed in as the same person sees it.
  await page.reload();
  await page.getByRole('tab', { name: /Templates/ }).click();
  await expect(page.getByLabel('Date polls start with')).toHaveValue(ids.Acme);

  // Create a Venn: the date form starts in Acme, says so, and makes Acme's poll.
  await page.goto('/new');
  await expect(page.locator('.brand-bar')).toContainText('Acme');
  await expect(page.locator('#default-note')).toHaveText('Using your default template, Acme. Use no template');
  await expect(page.locator('#title')).toHaveValue('Team lunch');
  await expect(page.locator('#location')).toHaveValue('The canteen');
  await noSideways(page);
  await noBlockingA11y(page, '/new with a default');
  // A vote has no default: Venn's look, no line.
  await page.getByRole('link', { name: '🗳️ Vote' }).click();
  await expect(page).toHaveURL(/\/new\/topic$/);
  await expect(page.locator('#title')).toBeVisible();
  await expect(page.locator('.brand-bar')).toHaveCount(0);
  await expect(page.locator('#default-note')).toHaveCount(0);
  // With a vote default too, Date ⇄ Vote swaps one default for the other, each with its line.
  expect((await page.request.put('/api/me/defaults', { data: { format: 'vote', template: ids['Book club'] } })).ok()).toBe(true);
  await page.getByRole('link', { name: '📅 Date' }).click();
  await expect(page.locator('#default-note')).toContainText('Acme');
  await page.getByRole('link', { name: '🗳️ Vote' }).click();
  await expect(page.locator('#default-note')).toContainText('Book club');
  await expect(page.locator('.brand-bar')).toContainText('Book club');
});

test('Use no template is for this poll only; a template link and a copied poll come first', async ({ browser }, info) => {
  test.slow();
  const { page, ids } = await signedIn(browser, info, { Acme: { title: 'Team lunch' }, Other: { title: 'Board games' } });
  for (const format of ['date', 'vote'])
    expect((await page.request.put('/api/me/defaults', { data: { format, template: ids.Acme } })).ok()).toBe(true);

  // "Use no template": plain Venn now, the default's title goes, and the link says so.
  await page.goto('/new/topic');
  await expect(page.locator('#default-note')).toBeVisible();
  await expect(page.locator('#title')).toHaveValue('Team lunch');
  await page.getByRole('button', { name: 'Use no template' }).click();
  await expect(page.locator('.brand-bar')).toHaveCount(0);
  await expect(page.locator('#default-note')).toHaveCount(0);
  await expect(page.locator('#title')).toBeFocused();
  await expect(page).toHaveURL(/\/new\/topic\?brand=none$/);
  await expect(page.getByRole('link', { name: '📅 Date' })).toHaveAttribute('href', '/new?brand=none');
  // Typed into, then reloaded: the typing stays, and nothing asks for a template called "none".
  const asked = [];
  page.on('request', (r) => /\/api\/brands\/none/.test(r.url()) && asked.push(r.url()));
  await page.fill('#title', 'Pizza or tacos');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('venn:draft:topic') || '')).toContain('Pizza or tacos');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Pizza or tacos');
  await expect(page.locator('.brand-bar')).toHaveCount(0);
  await expect(page.locator('#toast')).not.toContainText('template');
  // The same through the Date switch.
  await page.getByRole('link', { name: '📅 Date' }).click();
  await expect(page).toHaveURL(/\/new\?brand=none$/);
  // The date form is drawn (the vote form being left is busy, and takes no typing).
  await expect(page.locator('#create')).not.toHaveAttribute('aria-busy', 'true');
  await page.fill('#title', 'Team picnic');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('venn:draft:free') || '')).toContain('Team picnic');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Team picnic');
  await expect(page.locator('.brand-bar')).toHaveCount(0);
  expect(asked).toEqual([]);
  // The default stays.
  expect((await (await page.request.get('/api/me/defaults')).json()).defaults.vote.id).toBe(ids.Acme);

  // Another template's link wins over the default, and doesn't change it.
  await page.goto(`/new?brand=${ids.Other}`);
  await expect(page.locator('.brand-bar')).toContainText('Other');
  await expect(page.locator('#default-note')).toHaveCount(0);
  await expect(page.locator('#title')).toHaveValue('Board games');
  expect((await (await page.request.get('/api/me/defaults')).json()).defaults.date.id).toBe(ids.Acme);

  // A vote made with the template link, end to end: /new/topic?brand= makes Other's vote.
  await page.goto(`/new/topic?brand=${ids.Other}`);
  await expect(page.locator('.brand-bar')).toContainText('Other');
  await page.locator('#opts input').nth(0).fill('Catan');
  await page.locator('#opts input').nth(1).fill('Azul');
  await page.getByLabel(/Your name/).fill('Priya');
  await page.getByLabel(/Your email/).fill('priya@example.com');
  const body = created(page);
  await page.click('#submit');
  expect((await body).brand).toBe(ids.Other);

  // A copy of a plain vote stays plain: the poll's own look, not the default.
  const plain = await (
    await page.request.post('/api/events', {
      data: { title: 'Where to?', organizer: 'Priya', timezone: 'UTC', mode: 'topic', options: ['Rosa’s', 'Taco Loco'] },
    })
  ).json();
  await page.goto(`/new/topic?copy=${plain.id}`);
  await expect(page.locator('#title')).toHaveValue('Where to?');
  await page.waitForTimeout(300);
  await expect(page.locator('.brand-bar')).toHaveCount(0);
  await expect(page.locator('#default-note')).toHaveCount(0);
});

test('a draft keeps what it started in; an occasion or typed title is never replaced', async ({ browser }, info) => {
  test.slow();
  const { page, ids } = await signedIn(browser, info, { Acme: { title: 'Team lunch', note: 'Bring a dish' } });
  // A draft started before there was a default: picked up as it was, in Venn's look.
  await page.goto('/new');
  await page.fill('#title', 'Picnic');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('venn:draft:free'))).toContain('Picnic');
  expect((await page.request.put('/api/me/defaults', { data: { format: 'date', template: ids.Acme } })).ok()).toBe(true);
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Picnic');
  await expect(page.locator('#draft-note')).toBeVisible();
  await page.waitForTimeout(300); // the default would have come in by now
  await expect(page.locator('.brand-bar')).toHaveCount(0);

  // Started over: the default. Typed into, then reloaded: still the default's poll, with the typing.
  // Start over reloads the page itself: let that finish before going anywhere.
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Start over' }).click()]);
  await expect(page.locator('#draft-note')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('venn:draft:free') || '')).not.toContain('Picnic');
  await page.goto('/new');
  await expect(page.locator('#default-note')).toBeVisible();
  await page.fill('#title', 'Team lunch at noon');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('venn:draft:free') || '')).toContain('Team lunch at noon');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Team lunch at noon');
  await expect(page.locator('.brand-bar')).toContainText('Acme');
  await expect(page.locator('#desc')).toHaveValue('Bring a dish');

  // An occasion from a template page (/templates/…) keeps its own name and emoji; the look is Acme's.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/new?template=book-club');
  await expect(page.locator('.brand-bar')).toContainText('Acme');
  await expect(page.locator('#title')).not.toHaveValue('Team lunch');
});

test('a default that is gone: plain Venn, nothing said, nothing of it shown', async ({ browser }, info) => {
  const { page, ids } = await signedIn(browser, info, { Acme: { title: 'Team lunch' } });
  expect((await page.request.put('/api/me/defaults', { data: { format: 'date', template: ids.Acme } })).ok()).toBe(true);
  // Deleted: the server forgets the default on the next read.
  expect((await page.request.delete(`/api/brands/${ids.Acme}`)).ok()).toBe(true);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto('/new');
  await expect(page.locator('#title')).toHaveValue('Get-together');
  await page.waitForTimeout(300);
  await expect(page.locator('.brand-bar')).toHaveCount(0);
  await expect(page.locator('#default-note')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('');
  await expect(page.locator('#app')).not.toContainText('Acme');
  expect(errors).toEqual([]);
});

test('the template page: Make it my default ⇄ ✓ Your default, and a vote with it', async ({ browser }, info) => {
  const { page, ids } = await signedIn(browser, info, { Acme: {} });
  expect((await page.request.put('/api/me/defaults', { data: { format: 'vote', template: ids.Acme } })).ok()).toBe(true);
  await page.goto(`/brand/${ids.Acme}#organizer`);
  const toggle = page.locator('#b-default');
  await expect(toggle).toHaveText('✓ Your default for votes');
  await expect(toggle).toHaveAttribute('aria-pressed', 'mixed');
  await toggle.click();
  await expect(page.locator('#toast')).toHaveText('New date polls and votes start with Acme.');
  await expect(toggle).toHaveText('✓ Your default');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // By keyboard: Enter saves, and the focus stays on the button.
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toHaveText('New date polls and votes start with no template.');
  await expect(toggle).toHaveText('Make it my default');
  await expect(toggle).toBeFocused();
  await expect(toggle).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('link', { name: 'Or make a vote with it' })).toHaveAttribute(
    'href',
    `/new/topic?brand=${ids.Acme}`,
  );
  await noSideways(page);
  await noBlockingA11y(page, 'template page with the default toggle');
});

test('signed out, nobody asks for defaults', async ({ page }) => {
  const asked = [];
  page.on('request', (r) => r.url().includes('/api/me/defaults') && asked.push(r.url()));
  await page.goto('/new');
  await expect(page.locator('#title')).toBeVisible();
  await page.goto('/new/topic');
  await expect(page.locator('#title')).toBeVisible();
  await page.waitForTimeout(300);
  expect(asked).toEqual([]);
});

test('signing in from a template link comes back to it, by email as by Google (C10)', async ({ page }, info) => {
  const email = `rio-${info.project.name}-${Date.now()}@example.com`.toLowerCase();
  // An account with an email and password, made and confirmed, then signed out.
  await page.goto('/me#signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('tangerine-kayak-41');
  await page.locator('.em-submit').click();
  let link;
  await expect
    .poll(async () => {
      const mails = await (await page.request.get(`${FAKE_OAUTH_URL}/outbox?to=${encodeURIComponent(email)}`)).json();
      return (link = mails.at(-1)?.text.match(/https?:\/\/\S+#t=[\w-]{43}/)?.[0]);
    })
    .toBeTruthy();
  await page.goto(link);
  await page.getByRole('button', { name: 'Confirm and sign in' }).click();
  await expect(page).toHaveURL(/\/me$/);
  const { id } = await (await page.request.post('/api/brands', { data: { name: 'Riverside', title: 'Book club' } })).json();
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.removeItem('venn:account'));

  // A template link, opened signed out: Sign in, then straight back to it.
  await page.goto(`/new?brand=${id}`);
  await expect(page.locator('.brand-bar')).toContainText('Riverside');
  const signIn = page.locator('.menu-panel .acct-group-out a');
  await expect(signIn).toHaveAttribute('href', `/me?next=${encodeURIComponent(`/new?brand=${id}`)}`);
  await page.goto(await signIn.getAttribute('href'));
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
    'href',
    `/api/auth/google?next=${encodeURIComponent(`/new?brand=${id}`)}`,
  );
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('tangerine-kayak-41');
  await page.locator('.em-submit').click();
  await expect(page).toHaveURL(new RegExp(`/new\\?brand=${id}$`));
  await expect(page.locator('.brand-bar')).toContainText('Riverside');

  // Anything else in ?next= is never followed.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.removeItem('venn:account'));
  await page.goto(`/me?next=${encodeURIComponent('//evil.example/x')}`);
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute('href', '/api/auth/google?next=%2Fme');
});
