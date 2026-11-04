import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ACCOUNTS_URL } from '../playwright.config.js';
import { openTools } from './helpers.js';

// Sharing a poll and sharing a template (sprint D, PR D): each link says which it is, copying says
// it's done, and where the clipboard says no, the link shows to copy by hand (never a browser
// dialog). A template link says whose look the new poll is in, or that the template is gone. The
// template builder says what's saved, and asks in the page before leaving or deleting.

const start = Date.UTC(2030, 0, 10, 19);
const options = [0, 1].map((d) => ({ start: start + d * 864e5, end: start + d * 864e5 + 7200e3 }));

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
/** The builder's bar: its hint and every button it shows are inside the screen's width. */
const inView = async (page) => {
  const width = page.viewportSize().width;
  for (const el of await page.locator('.step-bar > :visible').all()) {
    const box = await el.boundingBox();
    if (box) expect(box.x + box.width, await el.evaluate((e) => e.id || e.className)).toBeLessThanOrEqual(width);
  }
};
/** No alert(), confirm() or prompt() on this page, ever. */
const noBrowserDialogs = (page) =>
  page.on('dialog', (d) => {
    throw new Error(`A browser dialog opened: ${d.type()} "${d.message()}"`);
  });
/** The clipboard says no, as in some in-app browsers. */
const noClipboard = (page) =>
  page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
  });
/** The link, selected in a read-only box, to copy by hand. */
async function byHand(page, value) {
  const box = page.locator('#copy-by-hand');
  await expect(box).toContainText('Copy this link:');
  const input = page.getByRole('textbox', { name: 'Copy this link:' });
  await expect(input).toHaveValue(value);
  await expect(input).toHaveAttribute('readonly', '');
  await expect(input).toBeFocused();
  expect(await input.evaluate((el) => [el.selectionStart, el.selectionEnd])).toEqual([0, value.length]);
}

const brandOf = async (request, data = {}) =>
  (await request.post('/api/brands', { data: { name: 'Acme', accent: '#1d4ed8', title: 'Team lunch', ...data } })).json();

test('the clipboard says no: the poll, organizer and template links show to copy by hand', async ({ page, request }) => {
  noBrowserDialogs(page);
  await noClipboard(page);
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: { title: 'Team lunch', timezone: 'UTC', organizer: 'Sam', mode: 'options', options },
    })
  ).json();
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await page.locator('#copy').click();
  await byHand(page, `${new URL(page.url()).origin}/e/${id}`);
  await expect(page.locator('#copy')).toHaveText('Copy link'); // not "copied": it wasn't
  await noSideways(page);
  await noBlockingA11y(page, 'a poll link to copy by hand');

  await openTools(page);
  await page.locator('#copy-admin').click();
  await byHand(page, `${new URL(page.url()).origin}/e/${id}#admin=${adminToken}`);
  await expect(page.locator('#copy-by-hand')).toHaveCount(1); // one at a time

  const b = await brandOf(request);
  await page.goto(`/brand/${b.id}#admin=${b.adminToken}`);
  await page.getByRole('button', { name: 'Copy template link' }).click();
  await byHand(page, `${new URL(page.url()).origin}/new?brand=${b.id}`);
  await noSideways(page);
});

test('copied: the button says Link copied ✓, and each link is named for what it is', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  noBrowserDialogs(page);
  const b = await brandOf(request);
  await page.goto(`/brand/${b.id}#admin=${b.adminToken}`);
  await expect(page.getByRole('textbox', { name: 'Template link' })).toHaveValue(/\/new\?brand=/);
  await expect(page.locator('.brand-links')).toContainText(
    'Anyone with this link makes a new poll of their own in this look. They don’t see your polls or answers.',
  );
  const copyTemplate = page.getByRole('button', { name: 'Copy template link' });
  await copyTemplate.click();
  await expect(page.locator('.brand-links .btn-primary')).toHaveText('Link copied ✓');
  await expect(page.locator('#toast')).toHaveText('Template link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/new\\?brand=${b.id}$`));
  await expect(page.getByRole('button', { name: 'Copy template link' })).toBeVisible({ timeout: 4000 });
  await page.getByRole('button', { name: 'Copy manage link' }).click();
  await expect(page.locator('#toast')).toHaveText('Manage link copied. Keep it private.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/brand/${b.id}#admin=`));
  // No two buttons called Copy link meaning different things: the poll page's is the poll's.
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toHaveCount(0);
});

test('a template link: whose look it is, or that it is gone; the form works either way', async ({ browser, request }) => {
  const b = await brandOf(request, { name: 'Riverside Books' });
  const page = await (await browser.newContext()).newPage();
  noBrowserDialogs(page);
  await page.goto(`/new?brand=${b.id}`);
  await expect(page.locator('.brand-bar')).toContainText('Riverside Books');
  await expect(page.locator('#template-note')).toHaveText('A new poll of your own, in Riverside Books’s look.');
  await noSideways(page);
  await noBlockingA11y(page, 'a template link opened');
  // A vote from it says so too.
  await page.goto(`/new/topic?brand=${b.id}`);
  await expect(page.locator('#template-note')).toHaveText('A new poll of your own, in Riverside Books’s look.');

  // Gone, or never one (cut short, or garbled): said in the page, no toast, Venn's look.
  const gone = 'That template isn’t available any more, so this poll is in Venn’s look.';
  for (const link of ['/new?brand=Zz9NotATemplate', '/new?brand=bad!id', '/new/topic?brand=Zz9NotATemplate']) {
    await page.goto(link);
    await expect(page.locator('#template-note')).toHaveText(gone);
    await expect(page.locator('.brand-bar')).toHaveCount(0);
    await expect(page.locator('#toast')).toHaveText('');
    await page.fill('#title', 'Still works');
    await expect(page.locator('#title')).toHaveValue('Still works');
  }
  await noSideways(page);
  await noBlockingA11y(page, 'a template link that is gone');
});

test('the builder says what is saved, and asks in the page before leaving or deleting', async ({ page, request }) => {
  noBrowserDialogs(page);
  const b = await brandOf(request);
  await page.goto(`/brand/${b.id}#admin=${b.adminToken}`);
  const state = page.locator('#save-state');
  await page.locator('#next').click();
  await expect(page.locator('#b-name')).toBeVisible();
  await expect(state).toBeHidden();
  await page.fill('#b-name', 'Acme Books');
  await expect(state).toHaveText('Not saved yet');
  await expect(page.locator('#submit')).toHaveClass(/btn-primary/);
  await expect(page.locator('#next')).not.toHaveClass(/btn-primary/);
  await noSideways(page);
  await inView(page); // the page itself can't scroll sideways here (fitPhone), so check the bar
  await page.locator('#submit').click();
  await expect(state).toHaveText('Saved. Polls made from now on use it.');
  await inView(page);
  // What it changes on polls already made, said where their details are.
  await expect(page.locator('[data-panel="poll"]')).toContainText(
    'Changes to the look show on polls already made with this template. Their titles and details don’t change.',
  );

  // Changed again, then leaving: asked first. Keep editing stays; Leave goes.
  await page.fill('#b-name', 'Acme Books Club');
  await expect(state).toHaveText('Not saved yet');
  await page.locator('a.brand').first().click();
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(leave).toContainText('Your changes to this template will be lost.');
  await noBlockingA11y(page, 'leaving the builder unsaved');
  await leave.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(new RegExp(`/brand/${b.id}$`));
  await expect(page.locator('#b-name')).toHaveValue('Acme Books Club');
  await page.locator('a.brand').first().click();
  await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await (await request.get(`/api/brands/${b.id}`)).json()).name).toBe('Acme Books');

  // Saved, nothing is asked. Delete is asked in the page.
  await page.goto(`/brand/${b.id}`);
  await page.locator('#b-delete').click();
  const del = page.getByRole('dialog', { name: 'Delete Acme Books?' });
  await expect(del).toContainText('Polls already made with it keep working, in Venn’s look.');
  await del.getByRole('button', { name: 'Keep' }).click();
  await expect(del).toHaveCount(0);
  await page.locator('#b-delete').click();
  await page.getByRole('dialog', { name: 'Delete Acme Books?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('#toast')).toHaveText('Template deleted.');
  expect((await request.get(`/api/brands/${b.id}`)).status()).toBe(404);
});

test('a poll made from a template: its look follows the template, its details never do (D6)', async ({ page, request }) => {
  const b = await brandOf(request, { title: 'Team lunch', note: 'Bring a dish' });
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: {
        title: 'Team lunch',
        description: 'Bring a dish',
        timezone: 'UTC',
        organizer: 'Sam',
        mode: 'options',
        options,
        brand: b.id,
      },
    })
  ).json();
  const poll = async () => (await request.get(`/api/events/${id}`)).json();
  expect((await poll()).brand.accent).toBe('#1d4ed8');
  // The template changes: name, colour and what new polls start with.
  const now = {
    ...(await (await request.get(`/api/brands/${b.id}`)).json()),
    name: 'Acme Co',
    accent: '#b91c1c',
    title: 'Board games',
    note: 'New note',
  };
  expect((await request.put(`/api/brands/${b.id}`, { data: now, headers: { 'x-admin-token': b.adminToken } })).ok()).toBe(true);
  let ev = await poll();
  expect([ev.title, ev.description]).toEqual(['Team lunch', 'Bring a dish']);
  expect([ev.brand.name, ev.brand.accent]).toEqual(['Acme Co', '#b91c1c']);
  // Deleted: the poll still opens, with its details and answers, in Venn's look.
  await request.put(`/api/events/${id}/participants`, { data: { name: 'Ana', availability: {} } }).catch(() => {});
  expect((await request.delete(`/api/brands/${b.id}`, { headers: { 'x-admin-token': b.adminToken } })).ok()).toBe(true);
  ev = await poll();
  expect(ev.title).toBe('Team lunch');
  expect(ev.brand).toBeUndefined();
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('#ev-title')).toHaveText('Team lunch');
  await expect(page.locator('.brand-bar')).toHaveCount(0);
});

test.describe('signed in', () => {
  test.use({ baseURL: ACCOUNTS_URL });
  test('your own template link says nothing about whose look, and an account’s template has no manage link', async ({
    browser,
  }, info) => {
    const user = `share-${info.project.name}-${Date.now()}`;
    const context = await browser.newContext({ extraHTTPHeaders: { 'x-test-user': user } });
    const page = await context.newPage();
    await page.goto('/me');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await expect(page).toHaveURL(/\/me$/);
    const { id } = await (await page.request.post('/api/brands', { data: { name: 'Mine' } })).json();
    await page.goto(`/new?brand=${id}`);
    await expect(page.locator('.brand-bar')).toContainText('Mine');
    await page.waitForTimeout(300);
    await expect(page.locator('#template-note')).toHaveCount(0);
    // Kept with the account: no manage link to hand out, just where to find it.
    await page.goto(`/brand/${id}#organizer`);
    await expect(page.locator('.brand-links')).toContainText('You manage this template from your account.');
    await expect(page.getByRole('button', { name: 'Copy manage link' })).toHaveCount(0);

    // An invite link is made in the tap and copied as it arrives (the way iOS Safari allows).
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy link to use' }).click();
    await expect(page.locator('#toast')).toContainText('Whoever opens it can use this template.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/brand/${id}#join=[A-Za-z0-9]+$`));
    await expect(page.locator('#copy-by-hand')).toHaveCount(0);
  });

  test('an invite opened signed out: the secret is never in the sign-in link or the page’s storage, and is used once', async ({
    browser,
  }, info) => {
    const user = `invite-${info.project.name}-${Date.now()}`;
    const owner = await (await browser.newContext({ extraHTTPHeaders: { 'x-test-user': user } })).newPage();
    await owner.goto('/me');
    await owner.getByRole('link', { name: 'Continue with Google' }).click();
    await expect(owner).toHaveURL(/\/me$/);
    const { id } = await (
      await owner.request.post('/api/brands', { data: { name: 'Invite Club', primaryColor: '#2255aa' } })
    ).json();
    const { token } = await (await owner.request.post(`/api/brands/${id}/invites`, { data: { role: 'user' } })).json();
    const k = `venn:join:${id}`;

    const guest = await (await browser.newContext({ extraHTTPHeaders: { 'x-test-user': `${user}-g` } })).newPage();
    noBrowserDialogs(guest);
    await guest.goto(`/brand/${id}#join=${token}`);
    const google = guest.getByRole('link', { name: 'Continue with Google' });
    // The way back is just the template's page: no secret in the query string a server sees.
    await expect(google).toHaveAttribute('href', `/api/auth/google?next=${encodeURIComponent(`/brand/${id}`)}`);
    expect(await guest.evaluate(() => location.hash)).toBe('');
    // This tab notes only that a join waits; the secret is in an HttpOnly cookie the page can't read.
    expect(await guest.evaluate((key) => sessionStorage.getItem(key), k)).toBe('1');
    expect(await guest.evaluate(() => document.cookie)).not.toContain(token);
    const held = (await guest.context().cookies()).find((c) => c.name === `venn_join_${id}`);
    expect(held).toMatchObject({ value: token, httpOnly: true, sameSite: 'Lax', path: `/api/brands/${id}/join` });
    await google.click();
    await expect(guest).toHaveURL(new RegExp(`/brand/${id}$`));
    await expect(guest.locator('#toast')).toHaveText('Added to your templates.');
    // Gone once used: the note and the server's cookie.
    expect(await guest.evaluate((key) => sessionStorage.getItem(key), k)).toBeNull();
    expect((await guest.context().cookies()).find((c) => c.name === `venn_join_${id}`)).toBeUndefined();
    // The page's storage never held it.
    expect(await guest.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).not.toContain(token);
  });
});
