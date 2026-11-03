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

/** Each button on a card: outlined in the card's ink, readable on the card's colour, and 44px tall. */
const outlined = (page, sel) =>
  page.locator(sel).evaluateAll((els) => {
    const lum = (c) => {
      const [r, g, b] = c
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return els.map((el) => {
      const s = getComputedStyle(el);
      let card = el.parentElement;
      while (getComputedStyle(card).backgroundColor === 'rgba(0, 0, 0, 0)') card = card.parentElement;
      const [hi, lo] = [lum(s.color), lum(getComputedStyle(card).backgroundColor)].sort((x, y) => y - x);
      return {
        text: el.textContent.trim(),
        fill: s.backgroundColor,
        border: s.borderTopWidth,
        inked: s.borderTopColor === s.color,
        contrast: (hi + 0.05) / (lo + 0.05),
        height: el.getBoundingClientRect().height,
      };
    });
  });
const checkOutlined = (list) => {
  expect(list.length).toBeGreaterThan(0);
  for (const b of list) {
    expect(b.fill, b.text).toBe('rgba(0, 0, 0, 0)');
    expect(b.border, b.text).toBe('2px');
    expect(b.inked, b.text).toBe(true); // so the border's contrast is the text's
    expect(b.contrast, b.text).toBeGreaterThanOrEqual(4.5);
    expect(b.height, b.text).toBeGreaterThanOrEqual(44);
  }
};

for (const retro of [true, false])
  for (const scheme of ['light', 'dark'])
    test(`${retro ? 'retro' : 'classic'}, ${scheme}: nothing on the decided cards or the favourite is filled`, async ({
      page,
      request,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.emulateMedia({ colorScheme: scheme });
      // A date poll with an answer: Best date's Pick, then the picked date's card.
      const ev = await (
        await request.post('/api/events', {
          data: { title: 'Team lunch', timezone: 'UTC', organizer: 'Sam', mode: 'options', options, retro },
        })
      ).json();
      await request.post(`/api/events/${ev.id}/participants`, { data: { name: 'Ana', availability: { [options[0].start]: 2 } } });
      await page.goto(`/e/${ev.id}#admin=${ev.adminToken}`);
      if (await page.locator('#tab-group').isVisible()) await page.click('#tab-group');
      await expect(page.locator('.best-hero [data-pick]')).toBeVisible();
      checkOutlined(await outlined(page, '.best-hero [data-pick]'));
      await request.post(`/api/events/${ev.id}/finalize`, {
        data: { start: options[0].start },
        headers: { 'x-admin-token': ev.adminToken },
      });
      await page.reload();
      await expect(page.locator('.final-tell')).toBeVisible();
      checkOutlined(await outlined(page, '.final-tell .btn'));
      const share = page.locator('.final-tell [data-share]');
      if ((await share.textContent()) === 'Copy the link for everyone') {
        await share.click();
        await expect(share).toHaveText('Link copied ✓');
        await expect(share).toHaveText('Copy the link for everyone', { timeout: 4000 });
      }

      // A vote with an answer: the favourite's Pick, then the decided card.
      const vote = await (
        await request.post('/api/events', {
          data: { title: 'Where to?', organizer: 'Sam', timezone: 'UTC', mode: 'topic', retro, options: ['Park', 'Beach'] },
        })
      ).json();
      await request.post(`/api/events/${vote.id}/participants`, { data: { name: 'Ana', availability: { 1: 2 } } });
      await page.goto(`/e/${vote.id}#admin=${vote.adminToken}`);
      if (await page.locator('#tab-group').isVisible()) await page.click('#tab-group');
      await expect(page.locator('.best-hero [data-pick]')).toHaveText(/^Pick (Park|Beach)$/);
      checkOutlined(await outlined(page, '.best-hero [data-pick]'));
      await request.post(`/api/events/${vote.id}/finalize`, {
        data: { option: 1 },
        headers: { 'x-admin-token': vote.adminToken },
      });
      await page.reload();
      await expect(page.locator('.banner-final .final-tell')).toBeVisible();
      checkOutlined(await outlined(page, '.final-tell .btn'));
      await page.locator('.final-tell #copy').click();
      await expect(page.locator('.final-tell #copy')).toHaveText('Link copied ✓');
      await expect(page.locator('.final-tell #copy')).toHaveText('Copy link', { timeout: 4000 });
    });

test('on a wide screen, Copy link keeps its width when it says Link copied', async ({ page, request, context, isMobile }) => {
  test.skip(isMobile, 'full width on phones');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await organizer(page, request, {});
  const before = (await page.locator('#copy').boundingBox()).width;
  await page.click('#copy');
  await expect(page.locator('#copy')).toHaveText('Link copied ✓');
  expect((await page.locator('#copy').boundingBox()).width).toBe(before);
});
