import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addOptions } from './helpers.js';

// A poll in the retro look (a new poll's, like the site's, unless Classic mode is on): everyone sees
// it in neon; the rest of the app doesn't change.

test('a new poll is retro like the site: it opens in neon for everyone, and the app stays itself', async ({ page, browser }) => {
  await page.goto('/new/pick');
  await page.fill('#title', 'Game night');
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 3, [1140]);
  await expect(page.locator('html')).toHaveClass(/\bretro\b/);
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
  // The browser's bars match the night sky, not the classic page (no dark band under Safari's bar).
  for (const m of await g.locator('meta[name="theme-color"]').all()) await expect(m).toHaveAttribute('content', '#0d0221');
  // Leaving the poll leaves the look behind: a new poll that asks for the classic look shows it.
  await page.goto('/new?retro=0');
  await expect(html).not.toHaveClass(/\bretro\b/);
  await expect(page.locator('.footer').getByRole('switch', { name: 'Classic mode' })).toHaveAttribute('aria-checked', 'true');
});

test('in Classic mode, a new poll is classic for everyone', async ({ page, browser }) => {
  await page.goto('/new/pick');
  await page.locator('.footer').getByRole('switch', { name: 'Classic mode' }).click();
  await page.fill('#title', 'Game night');
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 2, [1140]);
  await page.click('#submit');
  await page.getByRole('button', { name: 'View poll' }).click();
  await expect(page).toHaveURL(/\/e\/[A-Za-z0-9]+/);
  const g = await (await browser.newContext()).newPage();
  await g.goto(page.url().split('#')[0]);
  await expect(g.locator('h1')).toContainText('Game night');
  await expect(g.locator('html')).not.toHaveClass(/\bretro\b/);
});

test('the poll keeps the look its organizer made it in: no look switch on the poll, not even for the organizer', async ({
  page,
  request,
}) => {
  const start = Date.UTC(2030, 0, 10, 19);
  for (const retro of [false, true]) {
    const { id, adminToken } = await (
      await request.post('/api/events', {
        data: {
          title: 'Game night',
          timezone: 'UTC',
          organizer: 'Sam',
          retro,
          mode: 'options',
          options: [{ start, end: start + 7200e3 }],
        },
      })
    ).json();
    await page.goto(`/e/${id}#admin=${adminToken}`);
    await expect(page.locator('h1')).toContainText('Game night');
    if (retro) await expect(page.locator('html')).toHaveClass(/\bretro\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bretro\b/);
    await expect(page.getByRole('switch', { name: 'Retro look' })).toHaveCount(0);
  }
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

test('a retro poll’s link preview is retro too: Venn’s retro image', async ({ request }) => {
  const start = Date.UTC(2030, 0, 10, 19);
  const make = async (retro) =>
    (
      await request.post('/api/events', {
        data: { title: 'Game night', timezone: 'UTC', mode: 'options', options: [{ start, end: start + 7200e3 }], retro },
      })
    ).json();
  const ogImage = async (id) =>
    /<meta property="og:image" content="([^"]+)"/.exec(await (await request.get(`/e/${id}`)).text())[1];
  const plain = await make(false);
  expect(await ogImage(plain.id)).toMatch(/\/og\.png$/);
  expect(await ogImage((await make(true)).id)).toMatch(/\/og-retro\.png$/);
});

test('no flash of the other look: a new poll and a retro poll are retro from their very first frame', async ({
  page,
  request,
}) => {
  // What the page looks like on the first frame it draws.
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      window.firstFrame = {
        retro: document.documentElement.classList.contains('retro'),
        bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), // the stylesheet's in
      };
    });
  });
  const retroBg = '#0d0221';
  // From the website's Create a Venn.
  await page.goto('/');
  await page
    .locator('.topbar')
    .getByRole('link', { name: /Create a Venn/ })
    .click();
  await expect(page).toHaveURL(/\/new/);
  await expect(page.locator('.footer .classic-switch')).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => window.firstFrame)).toEqual({ retro: true, bg: retroBg });
  // A poll in the retro look, opened by a guest.
  const start = Date.UTC(2030, 0, 10, 19);
  const { id } = await (
    await request.post('/api/events', {
      data: { title: 'Game night', timezone: 'UTC', mode: 'options', options: [{ start, end: start + 7200e3 }], retro: true },
    })
  ).json();
  await page.goto(`/e/${id}`);
  await expect(page.locator('#mine .row')).toHaveCount(1);
  expect(await page.evaluate(() => window.firstFrame)).toEqual({ retro: true, bg: retroBg });
  // And one in the usual look stays usual.
  const plain = await (
    await request.post('/api/events', {
      data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options: [{ start, end: start + 7200e3 }] },
    })
  ).json();
  await page.goto(`/e/${plain.id}`);
  await expect(page.locator('#mine .row')).toHaveCount(1);
  expect((await page.evaluate(() => window.firstFrame)).retro).toBe(false);
});
