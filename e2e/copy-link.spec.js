import { test, expect } from '@playwright/test';

// The organizer's Copy link at the top of their poll is outlined, so Create a Venn in the bar is the
// one filled button there (BRAND.md rule 1, #206). Its text stays readable, and it says when it's done.

const start = Date.UTC(2030, 0, 10, 19);
const options = [0, 1].map((d) => ({ start: start + d * 864e5, end: start + d * 864e5 + 7200e3 }));

/** The organizer's poll, as they see it. */
async function organizer(page, request, data) {
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: { title: 'Team lunch', timezone: 'UTC', organizer: 'Sam', mode: 'options', options, ...data },
    })
  ).json();
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('#copy')).toBeVisible();
  return id;
}

/** Copy link's look, its text's contrast on the page, and every filled accent button on the first screen. */
const look = (page) =>
  page.evaluate(() => {
    const rgb = (c) =>
      c
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    const lum = (c) => {
      const [r, g, b] = rgb(c).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const probe = document.createElement('i');
    document.body.append(probe);
    const colour = (v) => ((probe.style.color = `var(${v})`), getComputedStyle(probe).color);
    const accent = colour('--accent');
    const bg = colour('--bg');
    probe.remove();
    const b = document.querySelector('#copy');
    const s = getComputedStyle(b);
    const [hi, lo] = [lum(s.color), lum(bg)].sort((x, y) => y - x);
    const filled = [...document.querySelectorAll('a, button')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height && r.top < innerHeight && getComputedStyle(el).backgroundColor === accent;
      })
      .map((el) => el.className);
    return {
      fill: s.backgroundColor,
      border: `${s.borderTopWidth} ${s.borderTopColor}`,
      accentBorder: `2px ${accent}`,
      contrast: (hi + 0.05) / (lo + 0.05),
      height: b.getBoundingClientRect().height,
      filled,
    };
  });

/** The contrast of a button's text on its own fill. */
const pair = (el) => {
  const lum = (c) => {
    const [r, g, b] = c
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const s = getComputedStyle(el);
  const [hi, lo] = [lum(s.color), lum(s.backgroundColor)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const retro of [true, false])
  for (const scheme of ['light', 'dark'])
    test(`${retro ? 'retro' : 'classic'}, ${scheme}: Copy link is outlined, readable, and says Link copied`, async ({
      page,
      request,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.emulateMedia({ colorScheme: scheme });
      await organizer(page, request, { retro });
      const l = await look(page);
      expect(l.fill).toBe('rgba(0, 0, 0, 0)');
      expect(l.border).toBe(l.accentBorder);
      expect(l.contrast).toBeGreaterThanOrEqual(4.5);
      expect(l.height).toBeGreaterThanOrEqual(44);
      // Create a Venn is the one filled accent button on the first screen.
      expect(l.filled).toEqual([expect.stringMatching(/\bbtn-new\b/)]);
      await page.click('#copy');
      await expect(page.locator('#copy')).toHaveText('Link copied ✓');
      // Still under the finger (phones keep the hover after a tap): its soft fill keeps the text readable.
      expect(await page.locator('#copy').evaluate(pair)).toBeGreaterThanOrEqual(4.5);
      await expect(page.locator('#toast')).toHaveText('Link copied');
      await expect(page.locator('#copy')).toHaveText('Copy link', { timeout: 4000 });
    });

test("on a brand's poll, Copy link takes the brand's accent and stays readable, light and dark", async ({ page, request }) => {
  // A pale accent: the look makes a readable one from it.
  const brand = await (await request.post('/api/brands', { data: { name: 'Acme', accent: '#ffd319' } })).json();
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await organizer(page, request, { brand: brand.id });
    await expect(page.locator('.brand-bar')).toContainText('Acme');
    const l = await look(page);
    expect(l.fill).toBe('rgba(0, 0, 0, 0)');
    expect(l.border).toBe(l.accentBorder);
    expect(l.contrast).toBeGreaterThanOrEqual(4.5);
  }
});

test('guests see no change: their way to share is still the quiet link at the end', async ({ page, request }) => {
  const id = await organizer(page, request, {});
  const guest = await (await page.context().browser().newContext()).newPage();
  await guest.goto(`/e/${id}`);
  await expect(guest.locator('#copy')).toHaveText('Copy the link');
  await expect(guest.locator('#copy')).toHaveClass('link-btn');
  await expect(guest.locator('.poll-share .btn')).toHaveCount(0);
  await guest.context().close();
});
