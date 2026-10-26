import { test, expect } from '@playwright/test';
import { addDays, addOptions, nextMonth, showDate, showNextMonth, tapAt } from './helpers.js';

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

/** Skip the "Poll created!" celebration and open the new poll. */
const openNewPoll = (page) => page.getByRole('button', { name: /^(View poll|Open .+ →)$/ }).click();

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
  // A celebration, then the new poll.
  await expect(page.locator('.party [role=status]')).toHaveText(/Poll created!.*bringing people together/);
  // Sharing is the next step, so it's the main button.
  await expect(page.getByRole('button', { name: 'Share poll' })).toBeFocused();
  await expect(page.locator('#mine .row')).toHaveCount(14);
  await expect(page.locator('.party')).toHaveCount(0);
  await expect(page.locator('details.organizer')).toHaveAttribute('open', '');

  // The times the organizer offered are already their answer: yes to all of them.
  const row = (i) => page.locator('#mine .row').nth(i);
  await expect(page.locator('#mine .row[data-v="2"]')).toHaveCount(14);
  await expect(page.locator('#ev-meta')).toContainText('1 person answered');
  await page.click('#none');

  // The organizer changes it: yes to the first two, no to the third.
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
  await showNextMonth(page);
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
  await expect(page.locator('.banner-final')).toBeVisible(); // the date is saved
  const id = page.url().split('/e/')[1];
  const ics = await (await request.get(`/api/events/${id}/event.ics`)).text();
  expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
});

test('ask when people are free: days, looking for a run of days', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Cabin weekend');
  // Whole days is where it starts.
  await expect(page.locator('[data-level="days"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('#q-2w');
  await expect(page.locator('#summary')).toHaveText('14 days to choose from');
  await page.click('[data-step="1"]');
  await expect(page.locator('#span')).toHaveValue('2');
  await expect(page.locator('#free-list')).toContainText('2 days in a row');
  await page.click('#submit');

  await expect(page.locator('#mine .row')).toHaveCount(14);
  await expect(page.locator('#ev-details')).toContainText('Looking for 2 days in a row');
  await page.click('#none'); // the organizer starts free on every day they offered
  await page.locator('#mine .row').nth(3).locator('[data-vote="2"]').click();
  await page.locator('#mine .row').nth(4).locator('[data-vote="1"]').click();
  await page.fill('#name', 'Sam');
  await page.click('#save');
  await expect(page.locator('.best-hero')).toContainText('(2 days)');
  await expect(page.locator('.best-hero')).toContainText('1 of 1 can make it, 1 if needed');
});

test('ask when people are free: days that never make the run asked for can’t be created', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Cabin weekend');
  await page.click('#q-weekends'); // Fri – Sun, four times: 3 days in a row at most
  await page.fill('#span', '4');
  await expect(page.locator('#summary')).toHaveText('None of your days make 4 in a row. Pick days next to each other');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#submit').click({ force: true }); // Playwright treats aria-disabled as not clickable
  await expect(page.locator('#err')).toHaveText('None of your days make 4 in a row. Pick days next to each other');
  await expect(page.locator('#span')).toBeFocused();
  await page.fill('#span', '3');
  await expect(page.locator('#summary')).toHaveText('12 days to choose from');
  // A number out of range is shown as the nearest one that works.
  await page.fill('#span', '99');
  await page.locator('#span').blur();
  await expect(page.locator('#span')).toHaveValue('14');
  await page.fill('#span', '0');
  await page.locator('#span').blur();
  await expect(page.locator('#span')).toHaveValue('1');
});

test('month calendars open on next month near the end of this one, and quick picks show their month', async ({ page }) => {
  const shown = () => page.locator('.cal-day').first().getAttribute('data-date');
  // January 28: four days left, so February is where the choosing is.
  await page.clock.setFixedTime(new Date(2030, 0, 28, 12));
  await page.goto('/new/free');
  expect(await shown()).toBe('2030-02-01');
  await expect(page.locator('[data-nav="-1"]')).toBeEnabled(); // January is still there
  // January 20: most of the month is left.
  await page.clock.setFixedTime(new Date(2030, 0, 20, 12));
  await page.goto('/new/free');
  expect(await shown()).toBe('2030-01-01');
  // The next two weeks are mostly in January; four weekends mostly in February.
  await page.click('#q-2w');
  expect(await shown()).toBe('2030-01-01');
  await page.click('#q-weekends');
  expect(await shown()).toBe('2030-02-01');
});

test('ask when people are free: paint hours and see the best time', async ({ page, isMobile }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Book club');
  await page.click('[data-level="hours"]');
  await page.click('[data-flength="60"]');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'true');
  // The quick fills are the same mornings, afternoons and evenings as the parts of the day.
  await expect(page.locator('[data-fill="2"]')).toContainText('Evenings 6 – 10 PM');
  await page.click('[data-fill="0"]'); // mornings, all week
  await expect(page.locator('#free-list')).toContainText('9 AM – 12 PM');
  await page.click('#submit');
  // Guests start with mornings, afternoons and evenings; exact times are one tap away.
  await expect(page.locator('#quick-hours .part-vote').first()).toBeVisible();
  await page.click('[data-hview="exact"]');
  await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();
  await expect(page.locator('#mine .cell[data-slot]:not(.yes)')).toHaveCount(0); // the organizer is free when they offered
  await page.click('#none');
  // Phones show one day at a time, and the page still fits the screen.
  if (isMobile) await expect(page.locator('#hour-days .tv-chip')).toHaveCount(7);
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
  // This test server has no email, so the optional "email me a copy" field stays hidden.
  await expect(page.locator('#copy-field')).toBeHidden();
  // Checking a calendar is coming later; until then guests don't see it, and answering comes first.
  await expect(page.locator('#cal-btn')).toHaveCount(0);
  await expect(page.locator('#copy')).not.toHaveClass(/btn-primary/);

  await expect(page.locator('#save')).toHaveAttribute('data-ready', 'false');
  await page.click('#save');
  await expect(page.locator('#save-err')).toContainText('Add your name');
  await page.fill('#name', 'Priya Shah');
  await page.click('#save');
  await expect(page.locator('#save-err')).toContainText('Pick at least one option');

  // Picks are listed in words; a no is red.
  await page.locator('#mine .row').nth(0).locator('[data-vote="2"]').click();
  await page.locator('#mine .row').nth(1).locator('[data-vote="0"]').click();
  await expect(page.locator('#my-picks')).toContainText('1 yes, no to the other one');
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
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#summary')).toHaveText('Add at least one option to create the poll');
  await expect(page.locator('#options-list')).toContainText('Nothing yet');
  // It can still be reached and pressed: it says what's missing, and goes there.
  await page.locator('#submit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#err')).toHaveText('Add at least one option to create the poll');
  await expect(page).toHaveURL(/\/new\/pick$/);

  // Options appear as soon as there's a day and a time.
  await addOptions(page, 2, [1140]);
  await expect(page.locator('#options-list .chip')).toHaveCount(2);
  await expect(page.locator('#summary')).toHaveText('Give your poll a name to create the poll');
  await page.locator('#submit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#err')).toHaveText('Give your poll a name to create the poll');
  await expect(page.locator('#title')).toBeFocused();
  await page.fill('#title', 'Dinner');
  await expect(page.locator('#err')).toBeEmpty();
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');

  // Another time on the first day.
  const first = await nextMonth(page);
  await tapAt(page, first, 750);
  await expect(page.locator('#options-list .od-row').first().locator('.chip')).toHaveCount(2);
  await expect(page.locator('#options-list .od-row').nth(1).locator('.chip')).toHaveCount(1);
  await expect(page.locator('#options-list')).toContainText('Guests will choose from 3 options');

  // Tapping an option in the list switches it to if needed; its × on the calendar removes it.
  await page.locator('#options-list .chip-flip').first().click();
  await expect(page.locator('#options-list .chip.maybe')).toHaveCount(1);
  // It says so in words, and keeps its amber.
  await expect(page.locator('#options-list .chip.maybe')).toContainText('If needed');
  const bg = (l) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg(page.locator('#options-list .chip.maybe'))).not.toBe(
    await bg(page.locator('#options-list .chip:not(.maybe)').first()),
  );
  await expect(page.locator('.tg-block.opt-maybe')).toHaveCount(1);
  const second = await showDate(page, addDays(first, 1));
  await second.locator('.tg-block').hover();
  await expect(second.getByRole('button', { name: /^Remove 7 – 9 PM, / })).toBeVisible();
  await second.locator('.tg-x').click();
  await expect(page.locator('#options-list .od-row')).toHaveCount(1);
  await page.click('#submit');
  await expect(page.locator('#mine .row')).toHaveCount(2);
  // The organizer's answer: if needed for the one they switched.
  await expect(page.locator('#mine .row[data-v="1"]')).toHaveCount(1);
});

test('organizers are asked before a change removes several options at once', async ({ page }) => {
  /** Answer the next confirm() with `yes`, and return its message. */
  const answer = (yes) => {
    page.removeAllListeners('dialog');
    return new Promise((done) =>
      page.once('dialog', (d) => {
        done(d.message());
        yes ? d.accept() : d.dismiss();
      }),
    );
  };
  await page.goto('/new/pick');
  await addOptions(page, 2, [1140]);
  // Times and whole days don't mix, so switching to all day would clear them: saying no keeps both.
  let asked = answer(false);
  await page.click('[data-length="allday"]');
  expect(await asked).toBe("Switching to all day removes the 2 options you've added. Switch anyway?");
  await expect(page.locator('[data-length="120"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-length="allday"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#options-list .chip')).toHaveCount(2);
  asked = answer(true);
  await page.click('[data-length="allday"]');
  await asked;
  await expect(page.locator('#options-list')).toContainText('Nothing yet');

  // On "ask when people are free", one × can stand for a week of evenings.
  await page.goto('/new/free');
  await page.click('#q-2w');
  await page.click('[data-level="parts"]');
  const rows = page.locator('#free-list .od-row');
  const before = await page.locator('#free-list .chip').count();
  const rm = rows.first().locator('[data-rm-window]').last();
  asked = answer(false);
  await rm.click();
  expect(await asked).toMatch(/^Remove these \d+ evenings\?$/);
  await expect(page.locator('#free-list .chip')).toHaveCount(before);
  asked = answer(true);
  await rm.click();
  await asked;
  await expect(page.locator('#free-list .chip')).toHaveCount(before - 1);
});

test('organizers give their email when this server sends email', async ({ page }) => {
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), email: true } });
  });
  await page.goto('/new/free');
  await page.fill('#title', 'Cabin');
  await page.click('#q-2w');
  await expect(page.locator('#notify')).toBeVisible();
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#summary')).toHaveText('Add your email to create the poll');
  await page.fill('#notify', 'sam@example');
  await expect(page.locator('#summary')).toHaveText('Check your email address');
  await page.fill('#notify', 'sam@example.com');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');
});

test('the create pages say which time zone the times are in, and it can be changed', async ({ page, request }) => {
  const zoneName = (tz) =>
    page.evaluate(
      (tz) =>
        new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'longGeneric' })
          .formatToParts(new Date())
          .find((x) => x.type === 'timeZoneName').value,
      tz,
    );
  await startPick(page, 'Call with Tokyo', [1140]);
  const line = page.locator('#tz-box summary');
  const local = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await expect(line).toHaveText(`Times in ${await zoneName(local)} · Change`);
  // It's the organizer's own time zone, so the choice stays out of the way until asked for.
  await expect(page.locator('#tz')).toBeHidden();
  await line.click();
  await page.selectOption('#tz', 'Asia/Tokyo');
  await expect(line).toHaveText(`Times in ${await zoneName('Asia/Tokyo')} · Change`);
  await page.click('#submit');
  await openNewPoll(page);
  const ev = await (await request.get(`/api/events/${page.url().split('/e/')[1]}`)).json();
  expect(ev.timezone).toBe('Asia/Tokyo');
  // 7 PM in Tokyo.
  expect(new Date(ev.options[0].start).toISOString()).toMatch(/T10:00:00/);

  await page.goto('/new/free');
  await expect(page.locator('#tz-box summary')).toHaveText(`Times in ${await zoneName(local)} · Change`);
});

test('phone: no zoom on focus, tap targets, tap-to-pick dates, Save always in reach', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone-only behaviour');
  await page.goto('/new/pick');

  // iOS zooms into inputs under 16px.
  const small = await page.evaluate(
    () =>
      [...document.querySelectorAll('input:not([type=checkbox]):not([type=file]):not([type=hidden]), select, textarea')].filter(
        (e) => parseFloat(getComputedStyle(e).fontSize) < 16,
      ).length,
  );
  expect(small).toBe(0);

  // Drawing on a phone opens the day view: tapping the calendar adds an option of the chosen length.
  await expect(page.locator('[data-view="day"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('[data-length="60"]');
  await page.locator('.tg-scroll').scrollIntoViewIfNeeded();
  const grid = await page.locator('.tg-scroll').boundingBox();
  await page.touchscreen.tap(grid.x + grid.width / 2, grid.y + 40);
  await expect(page.locator('.tg-block')).toHaveCount(1);
  await page.locator('.tg-block').tap(); // tapping an option makes it if needed
  await expect(page.locator('.tg-block.opt-maybe')).toHaveCount(1);
  await page.locator('.tg-x').tap(); // and its × removes it
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
  // The organizer's own answer was saved with the poll; changing one shows Save in reach.
  await expect(page.locator('#save-state')).toContainText('21 of 21 answered');
  const save = await page.locator('#save').boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(page.viewportSize().height);
});

test('the week calendar opens at the plan’s time and pages a week at a time', async ({ page, isMobile }) => {
  await page.goto('/new/pick');
  const row = () => page.locator('.tg').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--row')));
  const opensAt = async () =>
    420 + Math.round((await page.locator('.tg-scroll').evaluate((el) => el.scrollTop)) / (await row())) * 30;
  // Coffee is a morning plan: the calendar opens at 8 AM, not the evening.
  await page.getByRole('button', { name: 'Coffee' }).click();
  await expect.poll(opensAt).toBe(480);
  await page.getByRole('button', { name: 'Dinner' }).click();
  await expect.poll(opensAt).toBeGreaterThan(840); // the evening, as far down as the calendar goes

  // ‹ › go a week at a time, and the week runs Sunday to Saturday.
  const next = page.getByRole('button', { name: 'Next week' });
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  await next.click();
  await page.click('[data-view="week"]');
  const days = page.locator('#picker .tg-col');
  await expect(days).toHaveCount(7);
  const first = await days.first().getAttribute('data-date');
  expect(new Date(`${first}T12:00:00Z`).getUTCDay()).toBe(0);
  await next.click();
  await expect(days.first()).toHaveAttribute('data-date', addDays(first, 7));
  if (!isMobile) return;

  // On a phone, the day view's strip shows the same week, and the next week is one tap away.
  await page.click('[data-view="day"]');
  await expect(page.locator('#picker .tv-chip').first()).toHaveAttribute('data-day', addDays(first, 7));
  await next.click();
  await expect(page.locator('#picker .tv-chip').first()).toHaveAttribute('data-day', addDays(first, 14));
  // Narrow week columns get a short label ("7p"), not one broken over three lines.
  await tapAt(page, addDays(first, 15), 1140);
  await page.click('[data-view="week"]');
  await expect(page.locator('.tg-block span')).toHaveText(/^(7p|19)$/);
  // The × has a 44px hit area: a near miss removes the option instead of switching it to if needed.
  const x = await page.locator('.tg-x').boundingBox();
  await page.touchscreen.tap(x.x - 7, x.y + x.height + 7);
  await expect(page.locator('.tg-block')).toHaveCount(0);
});

test('phone: the calendars leave room to scroll the page, and say how to use them first', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone-only behaviour');
  const half = page.viewportSize().height / 2;
  await page.goto('/new/pick');
  expect((await page.locator('.tg-scroll').boundingBox()).height).toBeLessThanOrEqual(half);
  await page.goto('/new/free');
  await page.click('[data-level="hours"]');
  expect((await page.locator('.pg-scroll').boundingBox()).height).toBeLessThanOrEqual(half);
  // The hint comes before the painter, not after it.
  const help = page.locator('#when-help');
  await expect(help).toContainText('drag the times on the left');
  expect((await help.boundingBox()).y).toBeLessThan((await page.locator('.pg-scroll').boundingBox()).y);
});

test('keyboard: add a time to "vote on a few dates" without the pointer', async ({ page }) => {
  await page.goto('/new/pick');
  await page.fill('#title', 'Book club');
  await page.click('[data-length="90"]');
  // Pressing Create with no options goes to the day to add one.
  await page.locator('#submit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#at-day')).toBeFocused();
  await page.getByRole('button', { name: 'Next week' }).click();
  const day = await page.locator('#picker .tg-col').first().getAttribute('data-date');
  await page.selectOption('#at-day', day);
  await page.selectOption('#at-time', '1110'); // 6:30 PM
  await page.locator('#at-add').focus();
  await page.keyboard.press('Enter');
  // The same option a tap makes, of the plan's length.
  await expect(page.locator('#options-list .chip')).toHaveCount(1);
  await expect(page.locator('#options-list .chip')).toContainText('6:30 – 8:00 PM');
  await expect(page.locator('.tg-block')).toHaveCount(1);
  await expect(page.locator('#at-add')).toBeFocused();
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');
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

test('the poll created celebration shows the dog; Share poll copies the link and opens the poll', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/new/pick');
  await page.getByRole('button', { name: 'Book club' }).click();
  await addOptions(page, 7, [1140]);
  await page.click('#submit');
  await expect(page.locator('.party [role=status]')).toContainText('Poll created!');
  await expect.poll(() => page.locator('.party-hero img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => (navigator.share = undefined)); // no share sheet here: the link is copied
  await page.getByRole('button', { name: 'Share poll' }).click();
  await expect(page).toHaveURL(/\/e\/\w+$/);
  await expect(page.locator('#toast')).toContainText('Invite link copied');
  await expect(page.locator('.party')).toHaveCount(0);
});

test('organizer privacy: required emails, hidden names, then hidden answers', async ({ page, browser }) => {
  await page.goto('/new/pick');
  await page.fill('#title', 'Secret supper');
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 7, [1140]);
  await page.locator('#privacy-opts summary').click();
  await page.getByRole('switch', { name: 'Ask everyone for their email' }).check();
  await page.getByRole('switch', { name: 'Hide names from guests' }).check();
  await page.click('#submit');
  await page.getByRole('button', { name: 'View poll' }).click();
  await expect(page.locator('#mine .row').first()).toBeVisible();
  const url = page.url();

  // Two guests answer. Each must give an email, and sees the others only as "Guest 1, 2…".
  const guest = await browser.newContext();
  const g = await guest.newPage();
  for (const [name, email] of [
    ['Ana', 'ana@example.com'],
    ['Lee', 'lee@example.com'],
  ]) {
    await g.goto(url);
    await expect(g.getByText('Only the organizer sees who answered.')).toBeVisible();
    await g.fill('#name', name);
    await g.locator('#mine .row').first().locator('[data-vote="2"]').click();
    await g.fill('#copy-to', '');
    await g.click('#save');
    await expect(g.locator('#save-err')).toHaveText(/Add your email/);
    await g.fill('#copy-to', email);
    await g.click('#save');
    await expect(g.locator('#save-state')).toHaveText('Saved');
    await g.evaluate(() => localStorage.clear()); // the next guest, on the same device
  }
  await g.goto(url);
  await expect(g.locator('#people')).toContainText('Guest 1');
  await expect(g.locator('#people')).not.toContainText('Ana');

  // The organizer sees everyone, with their emails, and hides the answers.
  await page.reload();
  await expect(page.locator('#people')).toContainText('Ana');
  await expect(page.locator('details.organizer')).toBeVisible();
  if (!(await page.locator('#privacy-open').isVisible())) await page.locator('details.organizer summary').click();
  await page.click('#privacy-open');
  await expect(page.locator('.email-list li')).toHaveText(['Ana ana@example.com', 'Lee lee@example.com']);
  await page.getByRole('switch', { name: "Hide everyone's answers from guests" }).check();
  await page.getByRole('button', { name: 'Save privacy settings' }).click();
  await expect(page.locator('#toast')).toHaveText('Privacy settings saved');

  // Now guests see only that answers are private, and how many people answered.
  await g.reload();
  if (await g.locator('#tab-group').isVisible()) await g.click('#tab-group'); // tabs are only on phones
  await expect(g.locator('#panel-group')).toContainText("Only the organizer sees everyone's answers.");
  await expect(g.locator('#people')).toBeHidden();
  await expect(g.locator('#ev-meta')).toContainText('3 people answered'); // the organizer and two guests
  await guest.close();
});

test('organizers edit a poll until someone answers, then duplicate it', async ({ page, request }) => {
  await startPick(page, 'Dinner', [1140]);
  await page.click('#submit');
  await openNewPoll(page);
  const url = page.url();

  // Nobody else has answered, so the poll can still be changed.
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('h1')).toHaveText('Edit your poll');
  await expect(page.locator('#title')).toHaveValue('Dinner');
  await expect(page.locator('#organizer')).toHaveValue('Sam');
  await expect(page.locator('#options-list')).toContainText('Guests will choose from 7 options');
  await page.fill('#title', 'Dinner, take two');
  await page.locator('#options-list [data-remove]').first().click();
  await page.click('#submit'); // Save changes
  await expect(page).toHaveURL(url);
  await expect(page.locator('#ev-title')).toHaveText('Dinner, take two');
  await expect(page.locator('#mine .row')).toHaveCount(6);
  await expect(page.locator('#mine .row[data-v="2"]')).toHaveCount(6); // the organizer's answer follows the new times

  // Once someone answers, the poll can only be duplicated.
  const id = url.split('/e/')[1];
  const ev = await (await request.get(`/api/events/${id}`)).json();
  await request.post(`/api/events/${id}/participants`, { data: { name: 'Ana', availability: { [ev.slots[0]]: 2 } } });
  await page.reload();
  if (!(await page.locator('#privacy-open').isVisible())) await page.locator('details.organizer summary').click();
  await expect(page.getByRole('link', { name: 'Edit poll' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Duplicate poll' }).click();
  await expect(page.locator('h1')).toHaveText('Vote on a few dates');
  await expect(page.locator('#title')).toHaveValue('Dinner, take two');
  await expect(page.locator('#options-list')).toContainText('Guests will choose from 6 options');
  await page.click('#submit');
  await openNewPoll(page);
  await expect(page).not.toHaveURL(url);
  await expect(page.locator('#ev-meta')).toContainText('1 person answered'); // a new poll, with only the organizer
});

test('"when are you free" polls come back to edit at their level: hours, or parts of the day', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Book club');
  await page.click('[data-level="hours"]');
  await page.click('[data-fill="0"]'); // mornings, all week
  await page.click('#submit');
  await openNewPoll(page);
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('#title')).toHaveValue('Book club');
  await expect(page.locator('[data-level="hours"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#free-list')).toContainText('9 AM – 12 PM');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');

  await page.goto('/new/free');
  await page.fill('#title', 'Coffee');
  await page.click('#q-2w');
  await page.click('[data-level="parts"]');
  await expect(page.locator('#summary')).toHaveText('42 times to choose from');
  await page.click('[data-fill="2"]'); // no evenings in the first week
  await expect(page.locator('#summary')).toHaveText('35 times to choose from');
  await page.click('#submit');
  await openNewPoll(page);
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('[data-level="parts"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#summary')).toHaveText('35 times to choose from');
});

test('on a phone, a tap marks a time on the exact grid and a swipe scrolls instead', async ({ page, request, isMobile }) => {
  test.skip(!isMobile, 'touch only');
  const { id } = await (
    await request.post('/api/events', {
      data: {
        title: 'Call',
        timezone: 'UTC',
        dates: ['2030-01-08'],
        startMinute: 540,
        endMinute: 1260,
        slotMinutes: 30,
        durationMinutes: 60,
      },
    })
  ).json();
  await page.goto(`/e/${id}`);
  await page.click('[data-hview="exact"]');
  const cell = page.locator('#mine .cell[data-slot]').nth(4);
  await expect(cell).toHaveCSS('touch-action', 'pan-y');
  await cell.scrollIntoViewIfNeeded();
  await cell.tap();
  await expect(page.locator('#mine .cell.yes')).toHaveCount(1);
  // The phone shows only the day's own times, from the first one.
  await expect(page.locator('#mine .cell[data-slot]')).toHaveCount(24);
});

test('guests are told before answering twice, and a bad email is caught on the phone', async ({ page, request }) => {
  const H = 3_600_000;
  const t0 = Date.UTC(2030, 0, 8, 18);
  const options = [0, 24].map((h) => ({ start: t0 + h * H, end: t0 + (h + 2) * H }));
  const { id } = await (
    await request.post('/api/events', {
      data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options, requireEmail: true },
    })
  ).json();
  await request.post(`/api/events/${id}/participants`, {
    data: { name: 'Marcus', availability: { [t0]: 2 }, email: 'm@example.com' },
  });
  await page.goto(`/e/${id}`);
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await page.fill('#name', 'Marcus');
  await page.fill('#copy-to', 'marcus@gmail');
  await page.click('#save');
  await expect(page.locator('#save-err')).toHaveText(/Check your email address/);
  await expect(page.locator('#copy-to')).toBeFocused();
  await expect(page.locator('#copy-to')).toHaveAttribute('aria-invalid', 'true');
  await page.fill('#copy-to', 'marcus@example.com');
  // Every dialog in these tests is accepted: answering again as a new person is still allowed.
  const asked = page.waitForEvent('dialog');
  await page.click('#save');
  expect((await asked).message()).toContain('Someone called Marcus has already answered');
  await expect(page.locator('#save-state')).toHaveText('Saved');
});

test("the organizer link on another device finds the organizer's own answer", async ({ page, browser }) => {
  await startPick(page, 'Dinner', [1140]);
  await page.click('#submit');
  await openNewPoll(page);
  await expect(page.locator('#mine .row').first()).toBeVisible();
  const url = page.url();
  const token = await page.evaluate((id) => JSON.parse(localStorage.getItem(`venn:${id}`)).adminToken, url.split('/e/')[1]);
  const other = await (await browser.newContext()).newPage();
  await other.goto(`${url}#admin=${token}`);
  await expect(other.locator('#edit-link')).toContainText('Answering as Sam.');
  await expect(other.locator('#edit-link')).not.toContainText('personal link');
  if (await other.locator('#tab-mine').isVisible()) await other.click('#tab-mine');
  await other.locator('#mine .row').first().locator('[data-vote="0"]').click();
  await other.click('#save');
  await expect(other.locator('#save-state')).toHaveText('Saved');
  const ev = await (await other.request.get(`/api/events/${url.split('/e/')[1]}`)).json();
  expect(ev.participants).toHaveLength(1); // the same answer, changed, not a second one
  await other.context().close();
});

test('with answers hidden, a guest stays on their own answer after sending it; a picked date says so', async ({
  page,
  request,
}) => {
  const t0 = Date.UTC(2030, 0, 8, 18);
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: {
        title: 'Dinner',
        timezone: 'UTC',
        mode: 'options',
        options: [{ start: t0, end: t0 + 7_200_000 }],
        hideResults: true,
      },
    })
  ).json();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/e/${id}`);
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await page.fill('#name', 'Ana');
  await page.click('#save');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#panel-mine')).toBeVisible();
  await request.post(`/api/events/${id}/finalize`, { data: { start: t0 }, headers: { 'x-admin-token': adminToken } });
  await page.reload();
  if (await page.locator('#tab-mine').isVisible()) await page.click('#tab-mine');
  await expect(page.locator('#panel-mine h2')).toHaveText('The date is picked. Can you make it?');
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

  await page.click('#writer-open');
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
  // Drawing on a week is where it starts.
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
  // Hovering an option shows its ×, which removes it.
  await page.locator('.tg-block').first().hover();
  await expect(page.locator('.tg-x').first()).toHaveCSS('opacity', '1');
  await page.locator('.tg-x').first().click();
  await expect(page.locator('.tg-block')).toHaveCount(1);
  await page.click('#submit');
  await expect(page.locator('#mine .row')).toHaveCount(1);
});

test('ask when people are free: parts of the day', async ({ page, request }) => {
  // Polls made before the calendar painter ask about mornings, afternoons and evenings; they still work.
  const day = (d, h) => Date.UTC(2030, 0, d, h);
  const options = [8, 9, 10].flatMap((d) => [
    { start: day(d, 12), end: day(d, 17) },
    { start: day(d, 18), end: day(d, 22) },
  ]);
  const { id } = await (
    await request.post('/api/events', { data: { title: 'Coffee', timezone: 'UTC', mode: 'options', layout: 'parts', options } })
  ).json();
  await page.goto(`/e/${id}`);

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

test('organizers mark options as available or if needed, drag edges to resize, and their answer is saved', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'drag with a mouse');
  await page.goto('/new/pick');
  await page.fill('#title', 'Dinner');
  await page.fill('#organizer', 'Sam');
  await page.click('.tv-nav [data-step="1"]');
  const grid = await page.locator('.tg-scroll').boundingBox();
  const col = async (i) => page.locator('.tg-col').nth(i).boundingBox();
  // A two-hour option (the default length), available.
  await page.mouse.click((await col(1)).x + 10, grid.y + 10);
  // Then one that only works if needed.
  await page.click(`[data-pbrush="1"]`);
  await page.mouse.click((await col(3)).x + 10, grid.y + 10);
  await expect(page.locator('.tg-block.opt-maybe')).toHaveCount(1);
  await expect(page.locator('#options-list .chip.maybe')).toHaveCount(1);

  // Drag the first option's bottom edge down two rows: 2 hours becomes 3.
  const first = page.locator('.tg-block:not(.opt-maybe)');
  await expect(first).toContainText('–');
  const before = await first.textContent();
  const handle = await first.locator('.tg-bottom').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 48, { steps: 4 });
  await page.mouse.up();
  await expect(first).not.toHaveText(before);
  await expect(page.locator('.tg-block')).toHaveCount(2); // a drag is not a tap: nothing removed

  await page.click('#submit');
  // The organizer's answer came with the poll: yes to one, if needed to the other.
  await expect(page.locator('#mine .row').nth(0)).toHaveAttribute('data-v', '2');
  await expect(page.locator('#mine .row').nth(1)).toHaveAttribute('data-v', '1');
  await expect(page.locator('#edit-link')).toContainText('Answering as Sam');
  await expect(page.locator('#mine .row').nth(0)).toContainText(/3 hours|– \d/);
});

test.describe('in UTC', () => {
  test.use({ timezoneId: 'UTC' });
  test('guests answer an hours poll with mornings, afternoons and evenings, then celebrate', async ({
    page,
    request,
    isMobile,
  }) => {
    const { id } = await (
      await request.post('/api/events', {
        data: {
          title: 'Brunch',
          timezone: 'UTC',
          organizer: 'Sam',
          dates: ['2030-01-08', '2030-01-09'],
          startMinute: 540,
          endMinute: 1260,
          slotMinutes: 30,
          durationMinutes: 60,
        },
      })
    ).json();
    await page.goto(`/e/${id}`);
    const quick = (d, k) => page.locator(`[data-quick="${d}|${k}"]`);
    await expect(quick('2030-01-08', 'all')).toBeVisible();
    await quick('2030-01-08', 'morning').click(); // free all morning
    await quick('2030-01-09', 'all').click();
    await quick('2030-01-09', 'all').click(); // if needed all day
    await expect(quick('2030-01-08', 'morning')).toHaveAttribute('data-v', '2');
    await expect(quick('2030-01-08', 'all')).toHaveAttribute('data-v', 'some');
    await expect(quick('2030-01-09', 'evening')).toHaveAttribute('data-v', '1');
    // The exact grid shows the same answers.
    await page.click('[data-hview="exact"]');
    await expect(page.locator('#mine .cell.yes')).toHaveCount(6);
    // Phones show one day of the grid at a time.
    if (!isMobile) await expect(page.locator('#mine .cell.maybe')).toHaveCount(24);

    await page.fill('#name', 'Ana');
    await expect(page.locator('#save')).toHaveText('Submit');
    await page.click('#save');
    await expect(page.locator('.party [role=status]')).toContainText('Answer sent!');
    await expect(page.locator('.party [role=status]')).toContainText('Sam can see it now');
    await page.click('.party-go');
    await expect(page.locator('.party')).toHaveCount(0);
    await expect(page.locator('#save')).toHaveText('Save changes');
  });
});

test('organizers paint different hours on different days, and guests mark within them', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drag to paint with a mouse; phones are covered by the quick fills');
  await page.goto('/new/free');
  await page.fill('#title', 'Drinks');
  await page.click('[data-level="hours"]');
  await page.click('[data-flength="60"]');
  await page.click('[data-pstep="1"]'); // next week, so every day is in the future
  const cell = (r, c) => page.locator(`.pg-cell[data-r="${r}"][data-c="${c}"]`);
  const drag = async (a, b) => {
    await a.scrollIntoViewIfNeeded();
    const p = await a.boundingBox();
    const q = await b.boundingBox();
    await page.mouse.move(p.x + 5, p.y + 5);
    await page.mouse.down();
    await page.mouse.move(q.x + 5, q.y + 5, { steps: 5 });
    await page.mouse.up();
  };
  // 7 – 9 PM (rows 24–27) on the first two days, then 10 – 11 AM (rows 6–7) on the third.
  await drag(cell(24, 0), cell(27, 1));
  await drag(cell(6, 2), cell(7, 2));
  await expect(page.locator('.pg-cell.on')).toHaveCount(10);
  const list = page.locator('#free-list .od-row');
  await expect(list).toHaveCount(2);
  await expect(list.first()).toContainText('7 – 9 PM');
  await expect(list.nth(1)).toContainText('10 – 11 AM');
  // Starting a stroke on a painted time erases.
  await drag(cell(27, 0), cell(27, 1));
  await expect(page.locator('.pg-cell.on')).toHaveCount(8);
  await page.click('#submit');

  // Guests get a grid with just those hours: 3 + 3 + 2 half hours.
  await expect(page.locator('#mine .cell[data-slot]')).toHaveCount(8);
  await expect(page.locator('#ev-details')).toContainText('Looking for 1 hour');
});

test('ask when people are free: zoom from whole days to parts of the day to hours', async ({ page, isMobile }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Picnic');
  await showNextMonth(page);
  for (const i of [0, 1]) await page.locator('.cal-day').nth(i).click();
  await expect(page.locator('#summary')).toHaveText('2 days to choose from');

  // Parts of the day keeps the days, with mornings, afternoons and evenings on a calendar.
  await page.click('[data-level="parts"]');
  await expect(page.locator('#summary')).toHaveText('6 times to choose from');
  await expect(page.locator('.pg-cell.part.on')).toHaveCount(isMobile ? 3 : 6); // phones show a day at a time
  // No morning on the first day: the list shows each day's parts.
  await page.locator('.pg-cell.part.on').first().click();
  await expect(page.locator('#summary')).toHaveText('5 times to choose from');
  const days = page.locator('#free-list .od-row');
  await expect(days).toHaveCount(2);
  await expect(days.first().locator('.chip')).toHaveCount(2);
  await expect(days.nth(1).locator('.chip')).toHaveCount(3);

  // Hours starts from those parts, and zooming out keeps the days.
  await page.click('[data-level="hours"]');
  await expect(days).toHaveCount(2);
  await expect(days.nth(1)).toContainText('9 AM – 5 PM');
  await page.click('[data-level="days"]');
  await expect(page.locator('#summary')).toHaveText('2 days to choose from');

  // Back in, each day keeps its parts.
  await page.click('[data-level="parts"]');
  await expect(page.locator('#summary')).toHaveText('5 times to choose from');
  await page.click('#submit');
  await expect(page.locator('.part-vote')).toHaveCount(5);
});
