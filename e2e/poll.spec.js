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

const GROUP = (m) => (m < 720 ? 'morning' : m < 1020 ? 'afternoon' : 'evening');

/**
 * Add options in the composer of "vote on a few dates": the first `days` days of next month (so every
 * day is in the future), at the given start times (minutes after midnight).
 */
async function addOptions(page, days, times = [1140]) {
  if (await page.locator('[data-pick-mode="compose"]').isVisible()) await page.click('[data-pick-mode="compose"]');
  await page.click('#draft-cal [data-nav="1"]');
  for (let i = 0; i < days; i++) await page.locator('#draft-cal .cal-day').nth(i).click();
  for (const t of times) {
    await page.click(`[data-tgroup="${GROUP(t)}"]`);
    await page.click(`[data-time="${t}"]`);
  }
}

/** Start a "vote on a few dates" poll: 7 days, at the given start times. */
async function startPick(page, title, times = [1140]) {
  await page.goto('/new/pick');
  await page.fill('#title', title);
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 7, times);
}

test('vote on a few dates: collect votes, pick the final date', async ({ page, request }) => {
  await startPick(page, 'Dinner', [780, 1140]);
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
  // A "no" is shown in red with a cross, not as an empty cell.
  await expect(page.locator('.matrix tbody tr').first().locator('td.m-no').first()).toContainText('✕');
  const best = page.locator('.best-hero');
  await expect(best).toContainText('Everyone can make it');
  // The host sees everyone by their full name.
  await expect(best.locator('.names')).toContainText('Sam, Lee');

  await best.locator('[data-pick]').click();
  await expect(page.locator('.banner-final')).toContainText("It's happening");
  await expect(page.locator('.banner-final a', { hasText: 'Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com/);
  const ics = await request.get(`/api/events/${id}/event.ics`);
  expect(await ics.text()).toContain('SUMMARY:Dinner');
});

test('a trip: options that last several days become all-day calendar events', async ({ page, request }) => {
  await page.goto('/new/pick');
  await page.click('[data-occasion="8"]'); // ✈️ Trip: several days, 3 by default
  await expect(page.locator('[data-length="days"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tg')).toHaveCount(0); // whole-day options are picked on the month only
  await expect(page.locator('#span')).toHaveValue('3');
  await page.click('[data-nav="1"]');
  for (const i of [0, 7, 14, 21, 3, 10, 17]) await page.locator('.cal-day').nth(i).click();
  await expect(page.locator('#summary')).toHaveText('7 options to vote on');
  // Each trip shows as a block on the calendar, and its length can be changed on its own.
  await expect(page.locator('.cal-day.in-trip')).toHaveCount(14);
  await page.locator('#options-list [data-trip][data-d="1"]').first().click();
  await expect(page.locator('#options-list .od-len').first()).toContainText('4 days');
  await expect(page.locator('.cal-day.in-trip')).toHaveCount(15);
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
  await page.click('[data-mark="days"]');
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
  for (let i = 0; i < 2; i++) await page.click('[data-tstep="start"][data-d="30"]'); // 8 → 9 AM
  for (let i = 0; i < 22; i++) await page.click('[data-tstep="end"][data-d="-30"]'); // 11 PM → noon
  await expect(page.locator('#start-out')).toHaveText('9 AM');
  await expect(page.locator('#end-out')).toHaveText('12 PM');
  await page.click('[data-duration="60"]');
  await expect(page.locator('#guest-preview')).toContainText("when they're free between 9 AM – 12 PM");
  await page.click('#submit');
  await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();
  // Phones show one day at a time, and the page still fits the screen.
  if (isMobile) await expect(page.locator('#hour-days .tv-chip')).toHaveCount(14);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - screen.width)).toBeLessThanOrEqual(0);

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
  await startPick(page, 'Width check', [600, 780, 1140]);
  await page.click('#submit');
  await page.click('#fill');
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('.matrix')).toBeVisible();
  // Against the device's width: on a phone, content that's too wide makes the browser zoom out instead.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - screen.width);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('unknown poll shows a friendly error', async ({ page }) => {
  await page.goto('/e/doesnotexist');
  await expect(page.getByRole('heading', { name: 'Poll not found' })).toBeVisible();
});

test('poll pages get their own tab icon', async ({ page }) => {
  const icon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await page.goto('/new');
  await expect(icon).toHaveAttribute('href', /\/favicon\.svg/);
  await page.goto('/e/doesnotexist');
  await expect(icon).toHaveAttribute('href', /\/favicon-poll\.svg/);
  await expect(page.locator('link[rel="icon"][sizes]')).toHaveAttribute('href', /\/favicon-poll\.ico/);
});

test('organizer sets up a webhook from the Notifications panel', async ({ page }) => {
  await startPick(page, 'Webhook poll');
  // This test server has no email service, so the email field stays hidden and says why.
  await expect(page.locator('#notify-field')).toBeHidden();
  await expect(page.locator('#notify-off')).toBeVisible();
  await page.click('#submit');
  await page.click('#notify-open');
  await expect(page.locator('#n-email')).toHaveCount(0);
  await expect(page.locator('#email-off')).toBeVisible();
  // Webhooks are the custom option, with what they send written out for developers.
  await page.locator('.dev summary').click();
  await expect(page.locator('.dev pre')).toContainText('"event": "response.created"');

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

test('guests need a name and an answer to save, and can say none of these work', async ({ page, request }) => {
  const H = 3_600_000;
  const t0 = Date.UTC(2030, 0, 8, 18);
  const options = [0, 24].map((h) => ({ start: t0 + h * H, end: t0 + (h + 2) * H }));
  const { id } = await (
    await request.post('/api/events', { data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options } })
  ).json();
  await page.goto(`/e/${id}`);
  // Checking a calendar is coming later.
  await expect(page.locator('#cal-btn')).toBeDisabled();
  await expect(page.locator('#cal-btn')).toContainText('Coming soon');

  await expect(page.locator('#save')).toHaveAttribute('data-ready', 'false');
  await page.click('#save');
  await expect(page.locator('#save-err')).toContainText('Add your name');
  await page.fill('#name', 'Priya Shah');
  await page.click('#save');
  await expect(page.locator('#save-err')).toContainText('Pick at least one option');

  // Picks are listed in words; a no is red.
  await page.locator('#mine .row').nth(0).locator('[data-vote="2"]').click();
  await page.locator('#mine .row').nth(1).locator('[data-vote="0"]').click();
  await expect(page.locator('#my-picks')).toContainText('1 yes, no to the other 1');
  const no = page.locator('#mine .row').nth(1).locator('[data-vote="0"]');
  expect(await no.evaluate((b) => getComputedStyle(b).backgroundColor)).not.toBe(
    await page
      .locator('#mine .row')
      .nth(0)
      .locator('[data-vote="0"]')
      .evaluate((b) => getComputedStyle(b).backgroundColor),
  );
  await expect(page.locator('#save')).toHaveAttribute('data-ready', 'true');

  // "None of these work" is an answer too.
  await page.click('#decline');
  await expect(page.locator('#my-picks')).toContainText('none of these work');
  await page.click('#save');
  await expect(page.locator('#save-state')).toHaveText('Saved');
  // A guest who answered is offered a poll of their own.
  await expect(page.locator('#grow')).toBeVisible();
  await expect(page.locator('#grow a')).toHaveAttribute('href', '/new');
});

test('organizers add different times on different days, and see the whole poll before creating it', async ({ page }) => {
  await page.goto('/new/pick');
  // Create stays greyed out until the poll has a name and an option.
  await expect(page.locator('#submit')).toBeDisabled();
  await expect(page.locator('#summary')).toHaveText('Add at least one option to create the poll');
  await expect(page.locator('#options-list')).toContainText('Nothing yet');

  // Options appear as soon as there's a day and a time: no Add button.
  await addOptions(page, 2, [1140]);
  await expect(page.locator('#options-list .chip')).toHaveCount(2);
  await expect(page.locator('#summary')).toHaveText('Give your plan a name to create the poll');
  await page.fill('#title', 'Dinner');
  await expect(page.locator('#submit')).toBeEnabled();

  // Another time on the first day only.
  await page.locator('[data-add-to]').first().click();
  await expect(page.locator('[data-scope]').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-time="1230"]');
  await expect(page.locator('#options-list .od-row').first().locator('.chip')).toHaveCount(2);
  await expect(page.locator('#options-list .od-row').nth(1).locator('.chip')).toHaveCount(1);
  // Back to all days: a new time goes on both.
  await page.click('[data-scope=""]');
  await page.click('[data-time="1110"]');
  await expect(page.locator('#options-list')).toContainText('Guests will choose from 5 options');

  // Unpicking a day takes its options away.
  await page.locator('#draft-cal .cal-day[aria-pressed="true"]').nth(1).click();
  await expect(page.locator('#options-list .od-row')).toHaveCount(1);
  await page.click('#submit');
  await expect(page.locator('#mine .row')).toHaveCount(3);
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

  // Drawing on a phone opens the day view: tapping the calendar adds an option of the chosen length.
  await page.click('[data-pick-mode="calendar"]');
  await expect(page.locator('[data-view="day"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('[data-length="60"]');
  await page.locator('.tg-scroll').scrollIntoViewIfNeeded();
  const grid = await page.locator('.tg-scroll').boundingBox();
  await page.touchscreen.tap(grid.x + grid.width / 2, grid.y + 40);
  await expect(page.locator('.tg-block')).toHaveCount(1);
  await page.locator('.tg-block').tap(); // and tapping an option removes it
  await expect(page.locator('.tg-block')).toHaveCount(0);

  // Buttons are big enough to tap.
  const tooSmall = await page.evaluate(
    () =>
      [...document.querySelectorAll('.btn, .pill, .cal-day, .tv-chip')].filter(
        (b) => b.offsetParent && b.getBoundingClientRect().height < 40,
      ).length,
  );
  expect(tooSmall).toBe(0);

  // Create a long poll and answer the first option: Save stays on screen and shows progress.
  await page.fill('#title', 'Long poll');
  await addOptions(page, 7, [600, 780, 1140]);
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
  // The hero's two cards are the way in: each opens its kind of poll.
  await expect(page.locator('.topbar').getByRole('link', { name: 'Create a poll' })).toHaveCount(0);
  await page
    .locator('.start-cards')
    .getByRole('link', { name: /Ask when people are free/ })
    .click();
  await expect(page).toHaveURL(/\/new\/free$/);
  await expect(page.locator('#title')).toBeVisible();
  await page.goto('/');
  await page
    .locator('.start-cards')
    .getByRole('link', { name: /Vote on a few dates/ })
    .click();
  await expect(page).toHaveURL(/\/new\/pick$/);
  await expect(page.locator('#title')).toHaveAttribute('placeholder', "Dinner at Finn's");
  // /new (linked from the privacy and 404 pages) still offers both kinds of poll.
  await page.goto('/new');
  await expect(page.getByRole('heading', { name: 'What kind of poll?' })).toBeVisible();
  await page.getByRole('link', { name: 'Venn', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('installable: manifest and icons are served', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Venn');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  // Browser tabs: SVG and .ico favicons for the site and app, and for poll pages.
  for (const path of ['/favicon.svg', '/favicon.ico', '/favicon-poll.svg', '/favicon-poll.ico']) {
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
  const picked = page.locator('#options-list .chip');
  await expect(picked).toHaveCount(3);
  await expect(picked.first()).toContainText('2:00 – 2:45 PM');

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

test('organizer draws options on the week view, and removes one', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drag to draw is for a mouse; phones tap (see the phone test)');
  await page.goto('/new/pick');
  await page.fill('#title', 'Drinks');
  await page.click('[data-pick-mode="calendar"]');
  await expect(page.locator('[data-view="week"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('.tv-nav [data-step="1"]'); // next week, so every day is in the future
  const grid = await page.locator('.tg-scroll').boundingBox();
  const col = await page.locator('.tg-col').nth(2).boundingBox();
  // Drag down four rows: a two-hour option.
  await page.mouse.move(col.x + 10, grid.y + 10);
  await page.mouse.down();
  await page.mouse.move(col.x + 10, grid.y + 10 + 24 * 3, { steps: 4 });
  await page.mouse.up();
  // Click elsewhere: an option of the chosen length (2 hours).
  const col2 = await page.locator('.tg-col').nth(4).boundingBox();
  await page.mouse.click(col2.x + 10, grid.y + 10);
  await expect(page.locator('.tg-block')).toHaveCount(2);
  await expect(page.locator('#summary')).toHaveText('2 options to vote on');
  await expect(page.locator('#options-list .chip').first()).toContainText(/–/);
  await page.locator('.tg-block').first().click();
  await expect(page.locator('.tg-block')).toHaveCount(1);
  await page.click('#submit');
  await expect(page.locator('#mine .row')).toHaveCount(1);
});

test('ask when people are free: parts of the day', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Coffee');
  await expect(page.locator('[data-mark="parts"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('[data-ask="morning"]'); // afternoons and evenings only
  await page.click('[data-nav="1"]');
  for (let i = 0; i < 3; i++) await page.locator('.cal-day').nth(i).click();
  await expect(page.locator('#summary')).toHaveText('6 times to choose from');
  await page.click('#submit');

  await expect(page.locator('.part-vote')).toHaveCount(6);
  const part = (i) => page.locator('.part-vote').nth(i);
  await part(0).click(); // free
  await part(1).click();
  await part(1).click(); // if needed
  await expect(part(0)).toHaveAttribute('data-v', '2');
  await expect(part(1)).toHaveAttribute('data-v', '1');
  await expect(part(1)).toHaveAttribute('aria-pressed', 'mixed');
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('.best-hero')).toContainText('afternoon (12 – 5 PM)');
  await page.locator('.heat-btn').first().click();
  await expect(page.locator('#parts-inspect')).toContainText('Sam');
});

test('guests can see the options on a calendar and answer there', async ({ page, request }) => {
  const H = 3_600_000;
  const t0 = Date.UTC(2030, 0, 8, 17); // 5pm UTC, two overlapping options and one the next day
  const options = [
    { start: t0, end: t0 + 2 * H },
    { start: t0 + H, end: t0 + 3 * H },
    { start: t0 + 24 * H, end: t0 + 26 * H },
  ];
  const { id } = await (
    await request.post('/api/events', { data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options } })
  ).json();
  await page.goto(`/e/${id}`);
  await page.click('[data-mine-view="calendar"]');
  const block = (key) => page.locator(`.tg-block[data-key="${key}"]`);
  // Overlapping options sit side by side, so both can be tapped.
  await block(t0).click();
  await block(t0 + H).click();
  await block(t0 + H).click();
  await expect(block(t0)).toHaveClass(/ans-2/);
  await expect(block(t0 + H)).toHaveClass(/ans-1/);
  // The list shows the same answers.
  await page.click('[data-mine-view="list"]');
  await expect(page.locator('#mine .row').nth(0)).toHaveAttribute('data-v', '2');
  await expect(page.locator('#mine .row').nth(1)).toHaveAttribute('data-v', '1');
});
