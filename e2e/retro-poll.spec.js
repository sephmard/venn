import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addOptions } from './helpers.js';

// A poll in its organizer's "Retro look": everyone sees it in neon; the rest of the app doesn't change.

test('the organizer picks the retro look: the poll opens in neon for everyone, and the app stays itself', async ({
  page,
  browser,
}) => {
  await page.goto('/new/pick');
  await page.fill('#title', 'Game night');
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 3, [1140]);
  await page.getByRole('switch', { name: 'Retro look' }).check();
  await expect(page.locator('html')).toHaveClass(/\bretro\b/); // shown as soon as it's picked
  await page.click('#submit');
  // "Your Venn is ready!" is retro too: chrome capitals.
  await expect(page.locator('.party h2')).toHaveCSS('text-transform', 'uppercase');
  await page.getByRole('button', { name: 'View poll' }).click();
  const html = page.locator('html');
  await expect(html).toHaveClass(/\bretro\b/);
  await expect(page.locator('link[href="/retro-app.css"]')).toHaveCount(1);
  // A guest sees it too.
  const g = await (await browser.newContext()).newPage();
  await g.goto(page.url());
  await expect(g.locator('html')).toHaveClass(/\bretro\b/);
  await expect(g.locator('h1')).toHaveCSS('text-transform', 'uppercase');
  // Leaving the poll leaves the look behind.
  await page.goto('/new');
  await expect(html).not.toHaveClass(/\bretro\b/);
  await expect(page.getByRole('switch', { name: 'Retro look' })).not.toBeChecked();
});

test('the organizer can switch the retro look on later, from the top of the poll', async ({ page, request }) => {
  const start = Date.UTC(2030, 0, 10, 19);
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: {
        title: 'Game night',
        timezone: 'UTC',
        organizer: 'Sam',
        mode: 'options',
        options: [{ start, end: start + 7200e3 }],
      },
    })
  ).json();
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
  // The switch is on top of the poll, for the organizer; it takes at once, for everyone.
  const look = page.getByRole('switch', { name: 'Retro look' });
  await expect(look).toBeInViewport();
  await look.check();
  await expect(page.locator('html')).toHaveClass(/\bretro\b/);
  await expect.poll(async () => (await (await request.get(`/api/events/${id}`)).json()).retro).toBe(true);
  // The toast is an arcade box.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.locator('#toast')).not.toBeEmpty();
  await expect(page.locator('#toast')).toHaveCSS('font-family', /Press Start 2P/);
});

for (const scheme of ['light', 'dark'])
  test(`a retro poll passes the accessibility checks (${scheme})`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const start = Date.UTC(2030, 0, 10, 19);
    const { id } = await (
      await request.post('/api/events', {
        data: {
          title: 'Game night',
          timezone: 'UTC',
          organizer: 'Sam',
          retro: true,
          mode: 'options',
          options: [{ start, end: start + 7200e3 }],
        },
      })
    ).json();
    await page.goto(`/e/${id}`);
    await expect(page.locator('html')).toHaveClass(/\bretro\b/);
    await page.waitForFunction(() => [...document.styleSheets].some((s) => s.href?.endsWith('/retro-app.css')));
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
  });
