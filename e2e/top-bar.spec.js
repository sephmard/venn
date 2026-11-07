import { test, expect } from '@playwright/test';

// One top bar on every page (BRAND.md rule 1): the app's pages have the website's bar, the logo,
// Create a Venn and the menu, at a phone's width and a desktop's. The create pages leave out Create
// a Venn, since the form is the way on. White-label polls and /embed have no bar (embed.spec.js).

const options = (n) => {
  const start = Date.UTC(2031, 0, 6, 18);
  return Array.from({ length: n }, (_, i) => ({ start: start + i * 864e5, end: start + i * 864e5 + 4 * 3600e3 }));
};

for (const width of [390, 1200]) {
  test(`every app page has the website's top bar and menu, at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 800 });
    const made = await (
      await request.post('/api/events', {
        data: { title: 'Dinner at Rosa’s', organizer: 'Priya', timezone: 'UTC', mode: 'options', options: options(3) },
      })
    ).json();
    const routes = [
      ['/new', false],
      ['/new/topic', false],
      [`/e/${made.id}`, true],
      [`/e/${made.id}#admin=${made.adminToken}`, true],
      ['/me', true],
      ['/e/nosuchpoll1', true],
    ];
    for (const [path, create] of routes) {
      await page.goto('/');
      await page.goto(path);
      await page.locator('main h1, main h2').first().waitFor();
      const bar = page.locator('header.topbar');
      await expect(bar.getByRole('link', { name: 'Venn', exact: true }), path).toHaveAttribute('href', '/');
      const button = bar.getByRole('link', { name: 'Create a Venn' });
      if (create) {
        await expect(button, path).toBeVisible();
        await expect(button).toHaveAttribute('href', '/new');
        expect((await button.boundingBox()).height, path).toBeGreaterThanOrEqual(44);
      } else await expect(button, path).toBeHidden();
      // The menu opens, with the website's links, and closes on Escape.
      const toggle = bar.getByLabel('Menu');
      const box = await toggle.boundingBox();
      expect(Math.min(box.width, box.height), path).toBeGreaterThanOrEqual(44);
      await toggle.click();
      const panel = bar.locator('.menu-panel');
      for (const name of ['For organizations', 'For developers', 'Contact'])
        await expect(panel.getByRole('link', { name }), `${path}: ${name}`).toBeVisible();
      // Works with Claude is on the home page, not in the menu (Seph, Nov 4).
      await expect(panel.getByRole('link', { name: /Use with AI|Claude/ }), path).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(toggle).toBeFocused();
      // Nothing in the bar overlaps or pushes the page sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    }
  });
}

test('the logo and the menu stay in the same place going from the website into the app', async ({ page }) => {
  for (const width of [390, 1200]) {
    await page.setViewportSize({ width, height: 800 });
    const where = async (path) => {
      await page.goto(path);
      await page.locator('h1').first().waitFor();
      const logo = await page.locator('header.topbar .brand').boundingBox();
      const menu = await page.locator('header.topbar').getByLabel('Menu').boundingBox();
      return { logo: Math.round(logo.x), menu: Math.round(menu.x), bar: Math.round(logo.y) };
    };
    expect(await where('/new'), `${width}px`).toEqual(await where('/'));
  }
});

test("the app's menu closes on a tap outside it, or one of its links", async ({ page }) => {
  await page.goto('/new');
  const toggle = page.getByLabel('Menu');
  const panel = page.locator('.menu-panel');
  await toggle.click();
  await expect(panel).toBeVisible();
  await page.locator('main').click({ position: { x: 10, y: 10 } });
  await expect(panel).toBeHidden();
  await toggle.click();
  await panel.getByRole('link', { name: 'For organizations' }).click();
  await expect(page).toHaveURL(/\/brand$/);
  await expect(panel).toBeHidden();
});
