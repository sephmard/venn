import { test, expect } from '@playwright/test';
import { addOptions, showNextMonth, submit } from './helpers.js';
import AxeBuilder from '@axe-core/playwright';

// Automated accessibility checks (WCAG 2.2 A/AA rules from axe) on every main screen, in light and
// dark mode, on desktop and phone. Serious and critical problems fail the build.
async function audit(page, label, { party = false } = {}) {
  // A passing toast can sit over the page for a moment; it isn't part of what's being checked.
  await page.evaluate(() => {
    const t = document.getElementById('toast');
    if (t) t.textContent = '';
  });
  // Nor is the "poll created" celebration while it fades away (it has its own audit).
  if (!party) await expect(page.locator('.party')).toHaveCount(0, { timeout: 10_000 });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = blocking
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
    .join('\n');
  expect(blocking, `${label}\n${report}`).toEqual([]);
}

for (const scheme of ['light', 'dark']) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test('landing and privacy pages', async ({ page }) => {
      await page.goto('/');
      await audit(page, 'landing page');
      await page.goto('/privacy');
      await audit(page, 'privacy page');
    });

    test('create pages', async ({ page }) => {
      test.setTimeout(60_000); // eight scans
      page.on('dialog', (d) => d.accept()); // switching to trips clears the options with times, after asking
      await page.goto('/new');
      await audit(page, 'chooser');
      await page.goto('/new/pick');
      await page.fill('#organizer', 'Sam');
      await page.click('[data-occasion="0"]');
      await addOptions(page, 2);
      await audit(page, 'vote on a few dates (week or day)');
      await page.click('[data-length="days"]');
      await showNextMonth(page);
      await page.locator('.cal-day').first().click();
      await page.locator('.cal-grid').evaluate((el) => el.scrollIntoView({ block: 'center' })); // clear of the sticky bar
      await audit(page, 'vote on a few dates (trips)');
      await page.goto('/new/free');
      await page.fill('#organizer', 'Sam');
      await page.click('#q-2w');
      await page.locator('#free-list').evaluate((el) => el.scrollIntoView({ block: 'center' })); // clear of the sticky bar
      await audit(page, 'ask when people are free (whole days)');
      await page.click('[data-level="parts"]');
      await audit(page, 'ask when people are free (parts of the day)');
      await page.click('[data-level="hours"]');
      await audit(page, 'ask when people are free (painting hours)');
    });

    test('usage stats page', async ({ page }) => {
      await page.goto('/stats');
      await audit(page, 'stats sign-in');
      await page.fill('#token', 'test-stats');
      await page.click('#login button[type=submit]');
      await page.locator('.tile').first().waitFor();
      await audit(page, 'stats');
    });

    test('privacy options, the Privacy panel, and a guest with answers hidden', async ({ page, browser }) => {
      await page.goto('/new/free');
      await page.fill('#organizer', 'Sam');
      await page.fill('#title', 'Privacy check'); // whole days is where it starts
      await page.click('#q-2w');
      await page.locator('#privacy-opts summary').click();
      for (const name of ['Ask everyone for their email', "Hide everyone's answers from guests"])
        await page.getByRole('switch', { name }).check();
      await audit(page, 'create (privacy options)');
      await page.click('#submit');
      await page.getByRole('button', { name: 'View poll' }).click();
      await expect(page.locator('details.organizer')).toBeVisible();
      if (!(await page.locator('#privacy-open').isVisible())) await page.locator('details.organizer summary').click();
      await page.click('#privacy-open');
      await expect(page.locator('#privacy-form')).toBeVisible();
      await audit(page, 'organizer privacy panel');
      const guest = await browser.newContext({ colorScheme: scheme });
      const g = await guest.newPage();
      await g.goto(page.url());
      await expect(g.locator('#copy-to')).toBeVisible();
      await audit(g, 'guest, with email asked for and answers hidden');
      await guest.close();
    });

    test('the poll created celebration', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' }); // no confetti over the text
      await page.goto('/new/free');
      await page.fill('#organizer', 'Sam');
      await page.fill('#title', 'Celebration check');
      await page.click('#q-2w');
      await page.click('#submit');
      await expect(page.locator('.party [role=status]')).toContainText('Poll created!');
      // A modal dialog, named by its heading, with everything behind it out of reach.
      await expect(page.getByRole('dialog', { name: 'Poll created!' })).toBeVisible();
      await expect(page.locator('.party')).toHaveAttribute('aria-modal', 'true');
      expect(await page.evaluate(() => [...document.body.children].filter((n) => n.inert).map((n) => n.tagName))).toEqual(
        expect.arrayContaining(['HEADER', 'MAIN', 'FOOTER']),
      );
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement.closest('.party'))).toBe(true);
      }
      for (const b of await page.locator('.party button:visible').all())
        expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await audit(page, 'poll created', { party: true });
    });

    test('answering and results, as organizer', async ({ page }) => {
      page.on('dialog', (d) => d.accept());
      await page.goto('/new/pick');
      await page.fill('#organizer', 'Sam');
      await page.fill('#title', 'Accessibility check');
      await addOptions(page, 2);
      await page.click('#submit');
      await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
      await page.locator('#mine .row').nth(1).locator('[data-vote="1"]').click();
      await audit(page, 'event page (answering)');
      await page.click('[data-mine-view="calendar"]');
      await page.locator('.tg-block').first().click();
      await audit(page, 'event page (answering on the calendar)');
      await page.click('[data-mine-view="list"]');
      await page.fill('#name', 'Sam');
      await submit(page);
      await expect(page.locator('.matrix')).toBeVisible();
      await page.locator('.best-hero [data-pick]').click();
      await expect(page.locator('.banner-final')).toBeVisible();
      await page.click('#notify-open');
      await expect(page.locator('#notify-form')).toBeVisible();
      await page.locator('.dev summary').click();
      await audit(page, 'event page (organizer)');
    });

    test('days and hours polls', async ({ page }) => {
      test.setTimeout(60_000); // three polls, each with its celebration, and five scans
      page.on('dialog', (d) => d.accept()); // leaving a poll with unsaved answers asks first
      await page.goto('/new/free');
      await page.fill('#organizer', 'Sam');
      await page.fill('#title', 'Days check');
      await page.click('#q-2w');
      await page.click('#submit');
      await expect(page.locator('#mine .row').first()).toBeVisible();
      await audit(page, 'days poll');
      await page.goto('/new/free');
      await page.fill('#organizer', 'Sam');
      await page.fill('#title', 'Grid check');
      await page.click('[data-level="hours"]');
      await page.click('[data-fill="3"]');
      await page.click('#submit');
      await expect(page.locator('[data-hview="quick"]')).toBeVisible({ timeout: 10_000 }); // after the celebration
      await page.click('[data-hview="quick"]');
      await page.locator('#quick-hours .part-vote').first().click();
      await audit(page, 'hours poll (quick answers)');
      await page.click('[data-hview="exact"]');
      await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();
      await audit(page, 'hours poll (exact times)');
      // Older polls ask about mornings, afternoons and evenings.
      const day = (d, h) => Date.UTC(2030, 0, d, h);
      const options = [8, 9].flatMap((d) => [
        { start: day(d, 12), end: day(d, 17) },
        { start: day(d, 18), end: day(d, 22) },
      ]);
      const res = await page.request.post('/api/events', {
        data: { title: 'Parts check', timezone: 'UTC', mode: 'options', layout: 'parts', options },
      });
      await page.goto(`/e/${(await res.json()).id}`);
      await page.locator('.part-vote').first().click();
      await page.fill('#name', 'Sam');
      await submit(page);
      await page.locator('.heat-btn').first().click();
      await audit(page, 'parts of the day poll');
    });
  });
}

// A poll made through the API, opened as its organizer, optionally with answers and the date picked.
async function openPoll(page, { picked = false, names = [], ...fields } = {}) {
  const options = [8, 9, 10].map((d) => ({ start: Date.UTC(2030, 0, d, 18), end: Date.UTC(2030, 0, d, 20) }));
  const res = await page.request.post('/api/events', {
    data: { title: 'Dinner at Rosa’s', timezone: 'UTC', mode: 'options', options, ...fields },
  });
  const { id, adminToken } = await res.json();
  for (const name of names)
    await page.request.post(`/api/events/${id}/participants`, {
      data: { name, availability: { [options[0].start]: 2 } },
    });
  if (picked)
    await page.request.post(`/api/events/${id}/finalize`, {
      data: { start: options[0].start },
      headers: { 'x-admin-token': adminToken },
    });
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('#ev-title')).toBeVisible();
}

for (const scheme of ['light', 'dark']) {
  test(`the selected tab shows the focus ring (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 740 }); // the tabs are for narrow screens
    await openPoll(page);
    const tab = page.locator('[role=tab][aria-selected=true]');
    await page.locator('#copy').focus();
    // Tab through to the selected tab, so the browser treats it as keyboard focus.
    for (let i = 0; i < 20 && !(await tab.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(tab).toBeFocused();
    const ring = await tab.evaluate((el) => {
      const cs = getComputedStyle(el);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const probe = document.createElement('i');
      probe.style.color = accent;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return { width: cs.outlineWidth, style: cs.outlineStyle, offset: cs.outlineOffset, color: cs.outlineColor, accent: color };
    });
    expect(ring).toMatchObject({ width: '3px', style: 'solid', color: ring.accent });
    expect(parseFloat(ring.offset)).toBeGreaterThan(0);
  });
}

test('a long link in the note, or a long name, never makes the poll page scroll sideways at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  const url = `https://example.com/menu?ref=${'abcdefghij'.repeat(15)}`;
  await openPoll(page, {
    title: `Supercalifragilisticexpialidocious${'x'.repeat(30)}`,
    description: `Menu and directions: ${url}`,
    location: url,
    names: [`Maximiliana${'w'.repeat(60)}`, 'Ana'],
  });
  await expect(page.locator('.note')).toContainText('Menu and directions');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const share = await page.locator('#copy').boundingBox();
  expect(share.x + share.width).toBeLessThanOrEqual(375);
  const title = await page.locator('#ev-title').boundingBox();
  expect(title.x + title.width).toBeLessThanOrEqual(375);
  // The group: names wrap in their chips, and the results keep a narrow name column with "…".
  await page.click('#tab-group');
  await expect(page.locator('.matrix')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const name = page.locator('.matrix tbody th').first();
  expect((await name.boundingBox()).width).toBeLessThanOrEqual(110);
  expect(await name.locator('> :last-child').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

for (const width of [375, 412]) {
  test(`the picked date's buttons can be tapped on a phone (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openPoll(page, { picked: true });
    const banner = page.locator('.banner-final');
    await expect(banner).toBeVisible();
    // Whatever is under the middle of each button is the button itself, not the decorative circles.
    for (const el of await banner.locator('a, button').all()) {
      await el.scrollIntoViewIfNeeded();
      const hit = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return at === node || node.contains(at);
      });
      expect(hit, await el.innerText()).toBe(true);
      // Big enough to tap, and inside the screen.
      const box = await el.boundingBox();
      expect(box.height, await el.innerText()).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await banner.getByRole('button', { name: 'Clear the date' }).click();
    await expect(banner).toHaveCount(0);
  });
}

for (const scheme of ['light', 'dark']) {
  test(`"Add to your calendar" passes the checks at 375px (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 900 });
    await openPoll(page, { picked: true });
    await expect(page.getByRole('group', { name: 'Add to your calendar' })).toBeVisible();
    await audit(page, `picked date (${scheme})`);
  });
}
