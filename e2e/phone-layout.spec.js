// How things fit on a phone: short options on the calendar, times past midnight, and the smallest
// screens (320px) never scrolling sideways.

import { test, expect } from '@playwright/test';
import { addDays, nextMonth, showDate, tapAt } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => {
    throw e;
  });
});

/** A rectangle's box, for comparing where things are. */
const box = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());

test('a 30-minute option reads on one line, clear of its grips and ×, and its × has a 44px target', async ({
  page,
  isMobile,
}) => {
  await page.goto('/new/pick');
  await page.locator('#other-box summary').click();
  await page.selectOption('#custom', '30');
  const day = addDays(await nextMonth(page), 3);
  await tapAt(page, day, 1140);
  if (!isMobile) await page.click('#picker [data-view="day"]'); // the day view, as on a phone
  await showDate(page, day);
  const block = page.locator('#picker .tg-block').first();
  await expect(block).toHaveClass(/\btg-short\b/);
  const b = await box(block);
  for (const part of [block.locator('span'), block.locator('small')]) {
    const r = await box(part);
    // One line, inside the block, and left of the grips and the × (on the right).
    expect(r.height).toBeLessThan(20);
    expect(r.top).toBeGreaterThanOrEqual(b.top);
    expect(r.bottom).toBeLessThanOrEqual(b.bottom);
    expect(r.right).toBeLessThanOrEqual(b.right - 56);
  }
  await expect(block.locator('span')).toHaveText(/^7:00\s?–\s?7:30\sPM$/);
  await expect(block.locator('small')).toHaveText('Available');
  // The grips sit beside the ×, not over the text.
  const grip = await block
    .locator('.tg-handle')
    .last() // the bottom grip: on touch there's only that one
    .evaluate((el) => {
      const s = getComputedStyle(el, '::after');
      return el.getBoundingClientRect().right - parseFloat(s.right) - parseFloat(s.width);
    });
  expect(grip).toBeGreaterThanOrEqual((await box(block.locator('small'))).right);

  // On a touch screen the × is always there, and a finger 20px off its centre still hits it.
  const x = page.locator('#picker .tg-x').first();
  if (isMobile) {
    const r = await box(x);
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (const [dx, dy] of [
      [-20, 0],
      [0, -20],
      [0, 20],
    ]) {
      const hit = await page.evaluate(
        ([px, py]) => document.elementFromPoint(px, py)?.closest('.tg-x') != null,
        [cx + dx, cy + dy],
      );
      expect(hit, `${dx},${dy}`).toBe(true);
    }
    await x.tap();
  } else {
    await block.hover();
    await x.click();
  }
  await expect(page.locator('#picker .tg-block')).toHaveCount(0);
});

test('a phone’s week shows short options as their start time, and day names that fit', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the narrow week is for phones');
  await page.goto('/new/pick');
  await page.locator('#other-box summary').click();
  await page.selectOption('#custom', '30');
  const day = addDays(await nextMonth(page), 3);
  await tapAt(page, day, 1170);
  await page.click('#picker [data-view="week"]');
  await showDate(page, day);
  const block = page.locator('#picker .tg-block').first();
  await expect(block.locator('span')).toHaveText(/^7:30p$/);
  // No × in a column this narrow (the day view and the list have one), so the time isn't hidden.
  await expect(page.locator('#picker .tg-x-box')).toBeHidden();
  // "Mon" over "2": the same two lines on every day, neither broken, not "Mon / Nov / 2".
  const heads = page.locator('#picker .tg-day');
  await expect(heads.first().locator('.dh-dow')).toHaveText(/^\w+$/);
  await expect(heads.first().locator('.dh-num')).toHaveText(/^\d+$/);
  expect((await box(heads.first().locator('.dh-dow'))).height).toBeLessThan(20);
  const heights = await heads.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
});

test('times that run past midnight name their days, like the other ranges', async ({ page, request }) => {
  // 11 PM to 1 AM where the browser is, three days ahead.
  const [start, end] = await page.evaluate(() => {
    const d = new Date();
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3, 23);
    return [s.getTime(), s.getTime() + 2 * 3_600_000];
  });
  const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const { id } = await (
    await request.post('/api/events', {
      data: { title: 'Late one', timezone: tz, mode: 'options', options: [{ start, end }] },
    })
  ).json();
  await request.post(`/api/events/${id}/participants`, { data: { name: 'Lee', availability: { [start]: 2 } } });
  await page.goto(`/e/${id}`);
  const when = page.locator('#mine .row-when').first();
  await expect(when).toHaveText(/^[A-Z][a-z]{2} 11:00\sPM\s–\s[A-Z][a-z]{2} 1:00\sAM$/);
  await expect(when).not.toHaveText(/\d\/\d/);
  // Everyone's answers names each option's times too.
  if (await page.locator('#tab-group').isVisible()) await page.click('#tab-group');
  await expect(page.locator('#overlap .ov-when').first()).toContainText(/11:00\sPM/);
});

test.describe('on a 320px phone', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  /** Nothing is wider than the screen. */
  const fits = async (page, where) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(over, where).toBeLessThanOrEqual(0);
  };

  test('the main pages never scroll sideways', async ({ page, request }) => {
    for (const path of ['/', '/templates', '/templates/friendsgiving', '/new', '/new/pick', '/new/free']) {
      await page.goto(path);
      await page.locator('h1').first().waitFor();
      await fits(page, path);
      // And in a wider font, as some phones and CI's Linux use.
      await page.addStyleTag({ content: "* { font-family: 'DejaVu Sans', Verdana, sans-serif !important }" });
      await fits(page, `${path} (wide font)`);
      // The site's nav bar: the logo, Create a Venn and the menu, nothing on top of the logo.
      const brand = page.locator('.topbar .brand');
      if (await brand.count()) expect(await brand.evaluate((el) => el.scrollWidth <= el.clientWidth), path).toBe(true);
    }
    // Every length's calendar on "vote on a few dates".
    await page.goto('/new/pick');
    for (const len of ['allday', 'days', '60']) {
      await page.click(`[data-length="${len}"]`);
      await fits(page, len);
    }
    // A poll, as a guest: its answers, a picked date, and painting exact times.
    const day = addDays(await nextMonth(page), 2);
    const t0 = await page.evaluate((d) => new Date(`${d}T19:00`).getTime(), day);
    const { id, adminToken } = await (
      await request.post('/api/events', {
        data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options: [{ start: t0, end: t0 + 7_200_000 }] },
      })
    ).json();
    await page.goto(`/e/${id}`);
    await page.locator('#mine .row').first().waitFor();
    await fits(page, 'poll');
    // Yes, If needed and No all fit in the row.
    const row = await box(page.locator('#mine .row').first());
    expect((await box(page.locator('#mine .row [data-vote="0"]').first())).right).toBeLessThanOrEqual(row.right);
    await request.post(`/api/events/${id}/finalize`, { data: { start: t0 }, headers: { 'x-admin-token': adminToken } });
    await page.reload();
    await page.locator('.banner-final .cal-btn').first().waitFor();
    await fits(page, 'picked');
    for (const b of await page.locator('.banner-final .cal-btn').all()) {
      const r = await box(b);
      expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(r.height).toBeGreaterThanOrEqual(44);
    }
    const hours = await (
      await request.post('/api/events', {
        data: {
          title: 'Call',
          timezone: 'UTC',
          windows: [{ date: day, start: 540, end: 1020 }],
          slotMinutes: 30,
          durationMinutes: 60,
        },
      })
    ).json();
    await page.goto(`/e/${hours.id}`);
    await expect(page.locator('#mine .row')).toHaveCount(1);
    await fits(page, 'hours');
  });

  test('ask when people are available: the answer choices and days in a row fit, in a wide font too', async ({ page }) => {
    await page.goto('/new/free');
    await page.addStyleTag({ content: "* { font-family: 'DejaVu Sans', Verdana, sans-serif !important }" });
    // Days, Parts of day and Hours: one row, each on one line.
    const lines = async (sel) => {
      const tops = [];
      for (const b of await page.locator(sel).all()) {
        const r = await box(b);
        expect(r.height).toBeLessThan(50);
        tops.push(Math.round(r.top));
      }
      expect(new Set(tops).size).toBe(1);
    };
    await expect(page.locator('[data-level="hours"]')).toBeVisible(); // once the page is drawn
    await lines('[data-level]');
    await page.click('[data-level="parts"]');
    await expect(page.locator('#when .pg-cell').first()).toBeVisible(); // once the painter has loaded
    await expect(page.locator('#when-help')).toBeHidden();
    await page.click('[data-level="days"]');
    // No sentences explaining it: the tap key says how to tap.
    await expect(page.locator('#when-help')).toBeHidden();
    await expect(page.locator('.tap-key')).toBeVisible();
  });

  test('the calendar’s arrows keep their 44px, and two-digit days stay on one line', async ({ page }) => {
    await page.goto('/new/pick');
    await page.locator('#picker .tv-pick').waitFor();
    for (const b of await page.locator('#picker .tv-nav .icon-btn:visible').all()) {
      const r = await box(b);
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
    }
    // "2 hours" on one line, like the other length pills, in a wide font too (as some phones and CI use).
    await page.addStyleTag({ content: ".lengths .pill { font-family: 'DejaVu Sans', Verdana, sans-serif !important }" });
    for (const p of await page.locator('.lengths .pill').all()) expect((await box(p)).height).toBeLessThan(50);
    await page.click('[data-length="allday"]');
    // "28", not "2" over "8".
    const [h, size] = await page
      .locator('.cal-day:not([disabled])')
      .last()
      .evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents([...el.childNodes].find((n) => n.nodeType === 3 && /\d\d/.test(n.textContent)));
        return [r.getBoundingClientRect().height, parseFloat(getComputedStyle(el).fontSize)];
      });
    expect(h).toBeLessThan(size * 1.8);
  });
});
