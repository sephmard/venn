import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// RSVPs: the date is set, and guests say Going, Maybe or Can't go. Spots with a waitlist,
// plus-ones, and the organizer approving each RSVP.

async function noBlockingA11y(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking,
    `${label}\n${blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n')}`,
  ).toEqual([]);
}

const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Make an RSVP from /new, through the switch, and land on it as its organizer. */
async function createRsvp(page, { cap = null, plusOnes = false, approve = false } = {}) {
  await page.goto('/new');
  await page.getByRole('link', { name: '🎟️ RSVP' }).click();
  await expect(page).toHaveURL(/\/new\/rsvp$/);
  await expect(page.getByRole('heading', { name: 'When is it?' })).toBeVisible();
  await page.getByLabel('Name of your poll').fill('Summer party');
  await page.getByLabel('Date').fill('2031-06-07');
  await page.getByLabel('Starts').fill('19:00');
  await page.getByLabel('Ends').fill('22:00');
  if (cap) {
    await page.getByRole('switch', { name: 'Limit spots' }).check();
    await page.getByRole('spinbutton', { name: 'Spots' }).fill(String(cap));
  }
  if (plusOnes) await page.getByRole('switch', { name: 'Plus-ones' }).check();
  if (approve) await page.getByRole('switch', { name: 'Approve each RSVP' }).check();
  await page.getByLabel(/Your name/).fill('Priya');
  expect(await noSideways(page)).toBe(true);
  await page.click('#submit');
  await page.locator('.party-go').click();
  await page.locator('.party').waitFor({ state: 'detached' });
  await expect(page).toHaveURL(/\/e\/\w+$/);
  await expect(page.getByRole('heading', { name: 'Guest list' })).toBeVisible();
  return page.url();
}

async function rsvp(browser, url, name, answer, guests = null) {
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(url);
  await g.getByRole('button', { name: answer, exact: true }).click();
  if (guests != null) await g.getByLabel('Bringing').selectOption(String(guests));
  await g.getByLabel('Your name').fill(name);
  await g.getByRole('button', { name: 'RSVP', exact: true }).click();
  await expect(g.locator('#save')).toHaveText('Update RSVP');
  return g;
}

test('an RSVP with spots: guests go in order, then a waitlist', async ({ page, browser }) => {
  const url = await createRsvp(page, { cap: 2, plusOnes: true });
  await expect(page.locator('.banner-final')).toContainText('Sat, Jun 7');
  await expect(page.locator('#rsvp-spots')).toHaveText('2 spots left');

  const ana = await rsvp(browser, url, 'Ana', 'Going', 1);
  await expect(ana.locator('#save-state')).toHaveText(/You’re going, with 1 guest/);
  await noBlockingA11y(ana, 'guest after RSVP');
  expect(await noSideways(ana)).toBe(true);

  const ben = await rsvp(browser, url, 'Ben', 'Going');
  await expect(ben.locator('#save-state')).toHaveText(/#1 on the waitlist/);
  await expect(ben.locator('#rsvp-spots')).toHaveText('Full: new RSVPs join the waitlist');
  await rsvp(browser, url, 'Cy', 'Maybe');

  await page.reload();
  const going = page.locator('[data-group="going"]');
  await expect(going).toContainText('Ana');
  await expect(going).toContainText('+1');
  await expect(page.locator('[data-group="waitlist"]')).toContainText('Ben');
  await expect(page.locator('[data-group="maybe"]')).toContainText('Cy');

  // Ana can't go after all: Ben's in.
  await ana.getByRole('button', { name: 'Can’t go' }).click();
  await ana.getByRole('button', { name: 'Update RSVP' }).click();
  await expect(ana.locator('#save-state')).toHaveText(/You can’t go/);
  await ben.reload();
  await expect(ben.locator('#save-state')).toHaveText(/You’re going/);
});

test('approval: an RSVP waits for the organizer, who lets it in', async ({ page, browser }) => {
  const url = await createRsvp(page, { approve: true });
  await expect(page.locator('#rsvp-spots')).toHaveText('RSVPs need approval');
  const ana = await rsvp(browser, url, 'Ana', 'Going');
  await expect(ana.locator('#save-state')).toHaveText('Request sent. Priya will let you in.');
  // Guests don't see who's asking.
  await expect(ana.locator('#group-h + p')).toHaveText('Nobody’s going yet.');

  await page.reload();
  const asking = page.locator('[data-group="requested"]');
  await expect(asking).toContainText('Ana');
  await noBlockingA11y(page, 'organizer with a request');
  await page.getByRole('button', { name: 'Approve Ana' }).click();
  await expect(page.locator('[data-group="going"]')).toContainText('Ana');

  await ana.reload();
  await expect(ana.locator('#save-state')).toHaveText(/You’re going/);
});

test('the organizer changes the RSVP settings later', async ({ page }) => {
  await createRsvp(page);
  await expect(page.locator('#rsvp-spots')).toHaveCount(0);
  await page.getByText('Organizer tools').click();
  await page.getByRole('button', { name: 'RSVP settings' }).click();
  await page.getByRole('switch', { name: 'Limit spots' }).check();
  await page.getByRole('spinbutton', { name: 'Spots' }).fill('12');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#rsvp-spots')).toHaveText('12 spots left');
  expect(await noSideways(page)).toBe(true);
});

test('a white-label RSVP from a brand template, on its own page and inside another website’s frame', async ({ page }) => {
  const b = await (await page.request.post('/api/brands', { data: { name: 'Acme', accent: '#2563eb', hideVenn: true } })).json();
  // A brand template's form has the RSVP switch too, keeping the template.
  await page.goto(`/new?brand=${b.id}`);
  await expect(page.getByRole('link', { name: '🎟️ RSVP' })).toHaveAttribute('href', `/new/rsvp?brand=${b.id}`);
  const start = Date.UTC(2031, 5, 7, 18);
  const ev = await (
    await page.request.post('/api/events', {
      data: {
        title: 'Launch party',
        organizer: 'Sam',
        timezone: 'UTC',
        mode: 'rsvp',
        start,
        end: start + 7_200_000,
        brand: b.id,
        rsvp: { cap: 5 },
      },
    })
  ).json();
  for (const path of [`/e/${ev.id}`, `/embed/${ev.id}`]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Launch party' })).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/white-label/);
    await expect(page.locator('#rsvp-spots')).toHaveText('5 spots left');
    await expect(page).toHaveTitle('Launch party');
    await expect(page.locator('body')).not.toContainText('Venn', { useInnerText: true });
  }
  await page.getByRole('button', { name: 'Going', exact: true }).click();
  await page.getByLabel('Your name').fill('Ana');
  await page.getByRole('button', { name: 'RSVP', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText(/You’re going/);
  await expect(page.locator('#rsvp-spots')).toHaveText('4 spots left');
});
