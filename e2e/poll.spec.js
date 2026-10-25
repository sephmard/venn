import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => {
    throw e;
  });
  // The app must work under its own Content Security Policy.
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) throw new Error(msg.text());
  });
});

async function startPoll(page, title) {
  await page.goto('/new');
  await page.fill('#title', title);
  await page.fill('#organizer', 'Sam');
  await page.click('#weekdays');
}

test('propose specific times, collect votes, pick the final time', async ({ page, request }) => {
  await startPoll(page, 'Project kickoff');
  await expect(page.locator('[data-mode="options"]')).toHaveAttribute('aria-checked', 'true');

  const firstDay = await page.locator('[data-add]').first().getAttribute('data-add');
  await page.click(`[data-add="${firstDay}"]`); // suggested 9:00
  await page.click(`[data-add="${firstDay}"]`); // suggested 10:00
  await page.click(`[data-copy="${firstDay}"]`);
  await expect(page.locator('#summary')).toHaveText('10 times proposed');

  await page.click('#submit');
  await expect(page.locator('.opt')).toHaveCount(10);
  await expect(page.locator('.banner-admin')).toBeVisible();

  // Organizer answers: yes to the first two, no to the third.
  await page.locator('.opt').nth(0).locator('[data-vote="2"]').click();
  await page.locator('.opt').nth(1).locator('[data-vote="2"]').click();
  await page.locator('.opt').nth(2).locator('[data-vote="0"]').click();
  await expect(page.locator('.opt').nth(2)).toHaveAttribute('data-v', '0');
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('#save-state')).toHaveText('Saved');

  // A second person answers through the API: only the second time works for them.
  const id = page.url().split('/e/')[1];
  const ev = await (await request.get(`/api/events/${id}`)).json();
  await request.post(`/api/events/${id}/participants`, {
    data: { name: 'Lee', availability: { [ev.slots[0]]: 1, [ev.slots[1]]: 2 } },
  });

  await page.reload();
  await expect(page.locator('.matrix tbody tr')).toHaveCount(2);
  const best = page.locator('.best li').first();
  await expect(best).toContainText('Everyone can make it');
  await expect(best).toContainText('2/2');

  await best.locator('[data-pick]').click();
  await expect(page.locator('.banner-final')).toBeVisible();
  await expect(page.locator('.banner-final a', { hasText: 'Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com/);
  const ics = await request.get(`/api/events/${id}/event.ics`);
  expect(await ics.text()).toContain('SUMMARY:Project kickoff');
});

test('open time range: paint availability and see the best time', async ({ page, isMobile }) => {
  await startPoll(page, 'Book club');
  await page.click('[data-mode="grid"]');
  await expect(page.locator('#start')).toBeVisible();
  await page.click('#submit');
  await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();

  const cell = (r, c) => page.locator(`#mine .cell[data-r="${r}"][data-c="${c}"]`);
  // Keep the painted cells clear of the sticky Save bar at the bottom of the screen.
  await cell(2, 0).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  if (isMobile) {
    for (const r of [2, 3]) await cell(r, 0).tap();
  } else {
    const a = await cell(2, 0).boundingBox();
    const b = await cell(3, 1).boundingBox();
    await page.mouse.move(a.x + 5, a.y + 5);
    await page.mouse.down();
    await page.mouse.move(b.x + 5, b.y + 5, { steps: 4 });
    await page.mouse.up();
  }
  await expect(page.locator('#mine .cell.yes')).toHaveCount(isMobile ? 2 : 4);

  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('.best li').first()).toContainText('1/1');
});

test('page never scrolls sideways', async ({ page }) => {
  await startPoll(page, 'Width check');
  const day = await page.locator('[data-add]').first().getAttribute('data-add');
  for (let i = 0; i < 4; i++) await page.click(`[data-add="${day}"]`);
  await page.click(`[data-copy="${day}"]`);
  await page.click('#submit');
  await page.click('#fill');
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('.matrix')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('unknown poll shows a friendly error', async ({ page }) => {
  await page.goto('/e/doesnotexist');
  await expect(page.getByRole('heading', { name: 'Poll not found' })).toBeVisible();
});

test('organizer sets up a webhook from the Notifications panel', async ({ page }) => {
  await startPoll(page, 'Webhook poll');
  // This test server has no email service, so the email field stays hidden.
  await expect(page.locator('#notify-field')).toBeHidden();
  const day = await page.locator('[data-add]').first().getAttribute('data-add');
  await page.click(`[data-add="${day}"]`);
  await page.click('#submit');
  await page.click('#notify-open');
  await expect(page.locator('#n-email')).toHaveCount(0);

  await page.fill('#n-hook', 'http://example.com/hook');
  await page.click('#notify-form button[type=submit]');
  await expect(page.locator('#notify-err')).toContainText('https://');

  // A public IP address needs no DNS lookup, so this works offline.
  await page.fill('#n-hook', 'https://203.0.113.10/hook');
  await page.click('#notify-form button[type=submit]');
  await expect(page.locator('.secret-row code')).toContainText('whsec_');
  await expect(page.locator('#hook-status')).toContainText('Nothing sent yet');

  await page.click('#notify-close');
  await expect(page.locator('.notify-panel')).toHaveCount(0);
});

test('fill answers from Google Calendar and Outlook (mocked providers)', async ({ page, context, request }) => {
  const H = 3_600_000;
  const t0 = Date.UTC(2030, 0, 8, 15); // three one-hour options, an hour apart
  const options = [0, 2, 4].map((h) => ({ start: t0 + h * H, end: t0 + (h + 1) * H }));
  const { id } = await (
    await request.post('/api/events', { data: { title: 'Sync', timezone: 'UTC', mode: 'options', options } })
  ).json();

  // Google: the sign-in page sends the browser straight back with a token; freeBusy says the first option is busy.
  await context.route('https://accounts.google.com/**', (route) => {
    const u = new URL(route.request().url());
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.freebusy');
    const back = `${u.searchParams.get('redirect_uri')}#access_token=g-token&token_type=Bearer&expires_in=3600&state=${u.searchParams.get('state')}`;
    return route.fulfill({ status: 302, headers: { location: back } });
  });
  await context.route('https://www.googleapis.com/calendar/v3/freeBusy', (route) => {
    expect(route.request().headers().authorization).toBe('Bearer g-token');
    const busy = [{ start: new Date(options[0].start).toISOString(), end: new Date(options[0].end).toISOString() }];
    return route.fulfill({ json: { calendars: { primary: { busy } } } });
  });

  await page.goto(`/e/${id}`);
  await page.click('#cal-btn');
  await page.click('[data-provider="google"]');
  await expect(page.locator('#toast')).toContainText('Checked your Google Calendar: 2 of 3 times are free');
  await expect(page.locator('.opt').nth(0)).toHaveAttribute('data-v', '0');
  await expect(page.locator('.opt').nth(1)).toHaveAttribute('data-v', '2');

  // Microsoft: authorization code + PKCE, then calendarView. Busy on the 2nd, tentative on the 3rd.
  await context.route('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?**', (route) => {
    const u = new URL(route.request().url());
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const back = `${u.searchParams.get('redirect_uri')}?code=ms-code&state=${u.searchParams.get('state')}`;
    return route.fulfill({ status: 302, headers: { location: back } });
  });
  await context.route('https://login.microsoftonline.com/common/oauth2/v2.0/token', (route) => {
    const form = new URLSearchParams(route.request().postData());
    expect(form.get('code')).toBe('ms-code');
    expect(form.get('code_verifier')?.length).toBeGreaterThan(40);
    return route.fulfill({ json: { access_token: 'm-token', expires_in: 3600 } });
  });
  await context.route('https://graph.microsoft.com/v1.0/me/calendarView?**', (route) => {
    expect(route.request().headers().authorization).toBe('Bearer m-token');
    const at = (ms) => new Date(ms).toISOString().replace('Z', '0000');
    return route.fulfill({
      json: {
        value: [
          { start: { dateTime: at(options[1].start) }, end: { dateTime: at(options[1].end) }, showAs: 'busy' },
          { start: { dateTime: at(options[2].start) }, end: { dateTime: at(options[2].end) }, showAs: 'tentative' },
          { start: { dateTime: at(t0) }, end: { dateTime: at(t0 + 24 * H) }, showAs: 'busy', isAllDay: true },
        ],
      },
    });
  });

  await page.click('#cal-btn');
  await page.click('[data-provider="microsoft"]');
  await expect(page.locator('#toast')).toContainText(
    'Checked your Outlook: 1 of 3 times are free, 1 clash with tentative events',
  );
  await expect(page.locator('.opt').nth(0)).toHaveAttribute('data-v', '2');
  await expect(page.locator('.opt').nth(1)).toHaveAttribute('data-v', '0');
  await expect(page.locator('.opt').nth(2)).toHaveAttribute('data-v', '1');
});

test('phone: no zoom on focus, tap targets, tap-to-pick dates, Save always in reach', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone-only behaviour');
  await page.goto('/new');

  // iOS zooms into inputs under 16px.
  const small = await page.evaluate(
    () =>
      [...document.querySelectorAll('input, select, textarea')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16)
        .length,
  );
  expect(small).toBe(0);

  // Tapping a date toggles it.
  const day = page.locator('.cal-day:not([disabled])').last();
  await day.tap();
  await expect(page.locator('.cal-day.selected')).toHaveCount(1);
  await page.locator('.cal-day.selected').tap();
  await expect(page.locator('.cal-day.selected')).toHaveCount(0);

  // Buttons are big enough to tap.
  await page.click('#weekdays');
  const tooSmall = await page.evaluate(
    () => [...document.querySelectorAll('.btn')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40).length,
  );
  expect(tooSmall).toBe(0);

  // Create a long poll and answer the first time: Save stays on screen and shows progress.
  await page.fill('#title', 'Long poll');
  const first = await page.locator('[data-add]').first().getAttribute('data-add');
  for (let i = 0; i < 3; i++) await page.click(`[data-add="${first}"]`);
  await page.click(`[data-copy="${first}"]`);
  await page.click('#submit');
  await page.locator('.opt').first().locator('[data-vote="2"]').tap();
  await expect(page.locator('#save-state')).toContainText('1 of 15 answered');
  const save = await page.locator('#save').boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(page.viewportSize().height);
});

test('landing page leads to the poll creator', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText(/Find a time that works/);
  await page.locator('.site-hero').getByRole('link', { name: 'Create a poll' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator('#title')).toBeVisible();
  await page.getByRole('link', { name: 'Venn' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('installable: manifest and icons are served', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Venn');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
});
