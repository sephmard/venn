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

/** Start a "vote on a few dates" poll: the next 7 days, at the given times (minutes after midnight). */
async function startPick(page, title, times = [600]) {
  await page.goto('/new/pick');
  await page.fill('#title', title);
  await page.fill('#organizer', 'Sam');
  await page.click('#q-week');
  for (const m of times) await page.click(`#times [data-time="${m}"]`);
}

test('vote on a few dates: collect votes, pick the final date', async ({ page, request }) => {
  await startPick(page, 'Dinner', [1080, 1140]);
  await expect(page.locator('#summary')).toHaveText('14 options to vote on');

  await page.click('#submit');
  await expect(page.locator('#mine .row')).toHaveCount(14);
  await expect(page.locator('details.organizer')).toHaveAttribute('open', '');

  // The organizer answers: yes to the first two, no to the third.
  const row = (i) => page.locator('#mine .row').nth(i);
  await row(0).locator('[data-vote="2"]').click();
  await row(1).locator('[data-vote="2"]').click();
  await row(2).locator('[data-vote="0"]').click();
  await expect(row(2)).toHaveAttribute('data-v', '0');
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('#save-state')).toHaveText('Saved');
  // After the first save, the group's view is shown.
  await expect(page.locator('#panel-group')).toBeVisible();

  // A second person answers through the API: only the second option works for them.
  const id = page.url().split('/e/')[1];
  const ev = await (await request.get(`/api/events/${id}`)).json();
  await request.post(`/api/events/${id}/participants`, {
    data: { name: 'Lee', availability: { [ev.slots[0]]: 1, [ev.slots[1]]: 2 } },
  });

  await page.reload();
  await expect(page.locator('.matrix tbody tr')).toHaveCount(2);
  const best = page.locator('.best-hero');
  await expect(best).toContainText('Everyone can make it');

  await best.locator('[data-pick]').click();
  await expect(page.locator('.banner-final')).toContainText("It's happening");
  await expect(page.locator('.banner-final a', { hasText: 'Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com/);
  const ics = await request.get(`/api/events/${id}/event.ics`);
  expect(await ics.text()).toContain('SUMMARY:Dinner');
});

test('a trip: options that last several days become all-day calendar events', async ({ page, request }) => {
  await page.goto('/new/pick');
  await page.click('[data-occasion="7"]'); // ✈️ Trip: "A few days", 3 days
  await expect(page.locator('[data-length="days"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#times-sheet')).toBeHidden();
  await page.click('#q-week');
  await expect(page.locator('#summary')).toHaveText('7 options to vote on');
  await page.click('#submit');
  await expect(page.locator('#ev-title')).toHaveText('Trip');
  await expect(page.locator('#mine .row').first()).toContainText('–'); // a date range

  await page.click('#fill');
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await page.locator('.best-hero [data-pick]').click();
  const id = page.url().split('/e/')[1];
  const ics = await (await request.get(`/api/events/${id}/event.ics`)).text();
  expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
});

test('ask when people are free: days, looking for a run of days', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Cabin weekend');
  await page.click('#q-2w');
  await expect(page.locator('#summary')).toHaveText('14 days to choose from');
  await page.click('[data-step="1"]');
  await expect(page.locator('#span')).toHaveValue('2');
  await page.click('#submit');

  await expect(page.locator('#mine .row')).toHaveCount(14);
  await expect(page.locator('#ev-details')).toContainText('Looking for 2 days in a row');
  await page.locator('#mine .row').nth(3).locator('[data-vote="2"]').click();
  await page.locator('#mine .row').nth(4).locator('[data-vote="1"]').click();
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('.best-hero')).toContainText('(2 days)');
  await expect(page.locator('.best-hero')).toContainText('1 of 1 can make it, 1 if needed');
});

test('ask when people are free: paint hours and see the best time', async ({ page, isMobile }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Book club');
  await page.click('#q-2w');
  await page.click('[data-mark="hours"]');
  await page.click('[data-window="custom"]');
  await page.selectOption('#start', '540');
  await page.selectOption('#end', '720');
  await page.selectOption('#duration', '60');
  await page.click('#submit');
  await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();

  const cell = (r, c) => page.locator(`#mine .cell[data-r="${r}"][data-c="${c}"]`);
  // Keep the painted cells clear of the sticky Save bar at the bottom of the screen.
  await cell(1, 0).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  if (isMobile) {
    for (const r of [1, 2]) await cell(r, 0).tap();
  } else {
    const a = await cell(1, 0).boundingBox();
    const b = await cell(2, 1).boundingBox();
    await page.mouse.move(a.x + 5, a.y + 5);
    await page.mouse.down();
    await page.mouse.move(b.x + 5, b.y + 5, { steps: 4 });
    await page.mouse.up();
  }
  await expect(page.locator('#mine .cell.yes')).toHaveCount(isMobile ? 2 : 4);

  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('.best-hero')).toContainText('Works for the one person so far');
});

test('page never scrolls sideways', async ({ page }) => {
  await startPick(page, 'Width check', [600, 720, 1080, 1140]);
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
  await startPick(page, 'Webhook poll');
  // This test server has no email service, so the email field stays hidden.
  await expect(page.locator('#notify-field')).toBeHidden();
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
  await expect(page.locator('#notify-h')).toHaveCount(0);
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
  const row = (i) => page.locator('#mine .row').nth(i);
  await page.click('#cal-btn');
  await page.click('[data-provider="google"]');
  await expect(page.locator('#toast')).toContainText("Checked your Google Calendar: you're free for 2 of 3");
  await expect(row(0)).toHaveAttribute('data-v', '0');
  await expect(row(1)).toHaveAttribute('data-v', '2');

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
    "Checked your Outlook: you're free for 1 of 3, 1 clash with tentative plans",
  );
  await expect(row(0)).toHaveAttribute('data-v', '2');
  await expect(row(1)).toHaveAttribute('data-v', '0');
  await expect(row(2)).toHaveAttribute('data-v', '1');
});

test('phone: no zoom on focus, tap targets, tap-to-pick dates, Save always in reach', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone-only behaviour');
  await page.goto('/new/pick');

  // iOS zooms into inputs under 16px.
  const small = await page.evaluate(
    () =>
      [...document.querySelectorAll('input:not([type=checkbox]):not([type=file]), select, textarea')].filter(
        (e) => parseFloat(getComputedStyle(e).fontSize) < 16,
      ).length,
  );
  expect(small).toBe(0);

  // Tapping a date toggles it.
  const day = page.locator('.cal-day:not([disabled])').last();
  await day.tap();
  await expect(page.locator('.cal-day[aria-pressed="true"]')).toHaveCount(1);
  await page.locator('.cal-day[aria-pressed="true"]').tap();
  await expect(page.locator('.cal-day[aria-pressed="true"]')).toHaveCount(0);

  // Buttons are big enough to tap.
  await page.click('#q-week');
  const tooSmall = await page.evaluate(
    () =>
      [...document.querySelectorAll('.btn, .pill, .cal-day')].filter(
        (b) => b.offsetParent && b.getBoundingClientRect().height < 40,
      ).length,
  );
  expect(tooSmall).toBe(0);

  // Create a long poll and answer the first option: Save stays on screen and shows progress.
  await page.fill('#title', 'Long poll');
  for (const m of [600, 720, 900]) await page.click(`#times [data-time="${m}"]`);
  await page.click('#submit');
  await page.locator('#mine .row').first().locator('[data-vote="2"]').tap();
  await expect(page.locator('#save-state')).toContainText('1 of 21 answered');
  const save = await page.locator('#save').boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(page.viewportSize().height);
});

test('landing page: nav bar with GitHub, and the way to both kinds of poll', async ({ page, isMobile }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'GitHub' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/sephmard/venn');
  if (isMobile) {
    await page.locator('.menu summary').click();
    await expect(page.locator('.menu-panel').getByRole('link', { name: 'Privacy' })).toBeVisible();
    await page.locator('.menu summary').click();
  } else {
    await expect(nav.getByRole('link', { name: 'Privacy' })).toBeVisible();
  }
  await expect(page.locator('h1')).toHaveText(/Find the day that works/);
  // The hero card starts a poll: type the plan, then pick the kind of poll. Enter means "Vote on a few dates".
  const card = page.locator('.start-card');
  await card.getByRole('textbox', { name: 'What are you planning?' }).fill('Team lunch');
  await card.getByRole('button', { name: /Ask when people are free/ }).click();
  await expect(page).toHaveURL(/\/new\/free$/);
  await expect(page.locator('#title')).toHaveValue('Team lunch');
  await page.goto('/');
  await card.getByRole('textbox', { name: 'What are you planning?' }).fill('Book club');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/new\/pick$/);
  await expect(page.locator('#title')).toHaveValue('Book club');
  // The nav's "Create a poll" still offers both kinds of poll.
  await page.goto('/new');
  await expect(page.getByRole('heading', { name: 'What kind of poll?' })).toBeVisible();
  await page.getByRole('link', { name: 'Venn', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('installable: manifest and icons are served', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Venn');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  // Browser tabs: the SVG favicon, and the .ico that some browsers ask for by name.
  for (const path of ['/favicon.svg', '/favicon.ico']) {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/image/);
  }
});

test('AI: describe a poll in words, then summarize and write messages as the organizer', async ({ page }) => {
  await page.goto('/new/pick');
  await expect(page.locator('#ai-draft')).toBeVisible();
  await page.fill('#ai-prompt', '45 minute design review, afternoons later this week');
  await page.click('#ai-go');
  await expect(page.locator('#toast')).toContainText('Filled in 3 options');
  await expect(page.locator('#title')).toHaveValue('Design review');
  await expect(page.locator('[data-length="custom"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#custom')).toHaveValue('45');
  const picked = page.locator('#times [data-time][aria-pressed="true"]');
  await expect(picked).toHaveCount(3);
  await expect(picked.first()).toContainText('2:00 PM');

  await page.click('#submit');
  await expect(page.locator('#mine .row')).toHaveCount(3);
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('#save-state')).toHaveText('Saved');

  await page.click('#ai-summary-btn');
  await expect(page.locator('.ai-card')).toContainText('Most people can make the first option.');
  await page.locator('.ai-card [data-pick]').click();
  await expect(page.locator('.banner-final')).toBeVisible();

  await page.click('#ai-write-open');
  await page.click('[data-kind="announcement"]');
  await expect(page.locator('#ai-msg')).toHaveValue(/Hi team! .*\/e\/\w+/);
});

test('AI: answer for me, using preferences and calendar busy times', async ({ page, request }) => {
  const H = 3_600_000;
  const t0 = Date.UTC(2030, 0, 8, 15);
  const options = [0, 24].map((h) => ({ start: t0 + h * H, end: t0 + (h + 1) * H }));
  const { id } = await (
    await request.post('/api/events', { data: { title: 'Sync', timezone: 'UTC', mode: 'options', options } })
  ).json();

  await page.goto(`/e/${id}`);
  await page.click('#ai-answer-btn');
  await page.fill('#ai-prefs', 'No mornings please');
  await page.click('#ai-answer-go');
  await expect(page.locator('#toast')).toContainText('Filled in your answers');
  const row = (i) => page.locator('#mine .row').nth(i);
  await expect(row(0)).toHaveAttribute('data-v', '0');
  await expect(row(1)).toHaveAttribute('data-v', '2');
  await expect(row(0).locator('.row-note')).toHaveText('You said no mornings');
});
