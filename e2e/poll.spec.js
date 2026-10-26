import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { addDays, addOptions, nextMonth, showDate, showNextMonth, tapAt, todayIn, submit } from './helpers.js';

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
  await submit(page);
  await expect(page.locator('#save-state')).toHaveText('Submitted');
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
  await page.fill('#organizer', 'Sam');
  await page.getByRole('button', { name: 'Trip' }).click(); // ✈️ Trip: several days, 3 by default
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
  await submit(page);
  await page.locator('.best-hero [data-pick]').click();
  await expect(page.locator('.banner-final')).toBeVisible(); // the date is saved
  const id = page.url().split('/e/')[1];
  const ics = await (await request.get(`/api/events/${id}/event.ics`)).text();
  expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
});

test('ask when people are free: days, looking for a run of days', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
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
  await submit(page);
  await expect(page.locator('.best-hero')).toContainText('(2 days)');
  await expect(page.locator('.best-hero')).toContainText('1 of 1 can make it, 1 if needed');
});

test('ask when people are free: days that never make the run asked for can’t be created', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
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

test('ask when people are available: a tap picks days in a row, shown as one band and as a range', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Cabin weekend');
  await page.fill('#organizer', 'Sam');
  await page.fill('#span', '3');
  await expect(page.locator('#when-help')).toHaveText(
    'Tap a day to pick 3 days in a row from it. Tap a picked day to make it if needed, and again to take just that day away.',
  );
  await showNextMonth(page);
  const first = await nextMonth(page);
  const day = (n) => page.locator(`.cal-day[data-date="${addDays(first, n)}"]`);
  await day(0).click();
  await expect(page.locator('.cal-day[aria-pressed="true"]')).toHaveCount(3);
  // One band: joined in the middle, rounded only at its ends (or a little square over a line break).
  const cls = (n) => day(n).getAttribute('class');
  expect(await cls(0)).not.toMatch(/run-c?l/);
  expect(await cls(0)).toMatch(/run-c?r/);
  expect(await cls(1)).toMatch(/run-c?l.*run-c?r/);
  expect(await cls(2)).not.toMatch(/run-c?r/);
  const radius = (n, side) => day(n).evaluate((el, side) => getComputedStyle(el)[`border${side}Radius`], side);
  expect(['0px', '4px']).toContain(await radius(1, 'TopLeft'));
  expect(await radius(0, 'TopLeft')).toBe('14px');
  // The preview lists the run as a range, long enough for 3 in a row.
  const range = await page.evaluate(
    ([a, b]) =>
      new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).formatRange(
        new Date(`${a}T00:00Z`),
        new Date(`${b}T00:00Z`),
      ),
    [first, addDays(first, 2)],
  );
  const rows = page.locator('#free-list .od-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.chip-flip')).toHaveText(range);
  await expect(rows.first()).toContainText('3 days · long enough');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');

  // Tapping a picked day makes it if needed for the organizer; again takes just that day away, and the run splits.
  await day(1).click();
  await expect(page.locator('.cal-day[aria-pressed="true"]')).toHaveCount(3);
  await expect(day(1)).toHaveClass(/day-maybe/);
  await expect(day(1).locator('small')).toHaveText('If needed');
  await day(1).click();
  await expect(page.locator('.cal-day[aria-pressed="true"]')).toHaveCount(2);
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('1 day · too short');
  await expect(page.locator('#summary')).toHaveText('Pick at least 3 days, for 3 in a row (and 1 more thing)');

  // The keyboard does what a tap does, and stays on the day.
  await day(9).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cal-day[aria-pressed="true"]')).toHaveCount(5);
  await expect(day(9)).toBeFocused();
  await expect(rows).toHaveCount(3);
  await page.keyboard.press(' ');
  await expect(day(9)).toHaveClass(/day-maybe/);
  await page.keyboard.press(' ');
  await expect(day(9)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.cal-day[aria-pressed="true"]')).toHaveCount(4);
  // A run's × removes the whole run (after asking).
  await rows.last().locator('[data-rm-days]').click();
  await expect(rows).toHaveCount(2);
  await expect(page.locator('.cal-day[aria-pressed="true"]')).toHaveCount(2);
});

test('ask when people are available: what the organizer picks is available or if needed for them', async ({
  page,
  request,
  isMobile,
}) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Picnic');
  await page.fill('#organizer', 'Sam');
  await showNextMonth(page);
  const first = await nextMonth(page);
  const day = (n) => page.locator(`.cal-day[data-date="${addDays(first, n)}"]`);
  await expect(page.locator('[data-fbrush="2"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('[data-fbrush="1"]'); // if needed
  await day(0).click();
  await page.click('[data-fbrush="2"]');
  await day(2).click();
  await expect(page.locator('.cal-day.day-maybe')).toHaveCount(1);
  await expect(day(0)).toHaveClass(/day-maybe/);
  const chips = page.locator('#free-list .chip');
  await expect(chips.first()).toHaveClass(/maybe/);
  await expect(chips.first()).toContainText('If needed');
  await expect(chips.nth(1)).not.toHaveClass(/maybe/);
  // Tapping a day in the list switches it, and back.
  await chips.nth(1).locator('.chip-flip').click();
  await expect(page.locator('.cal-day.day-maybe')).toHaveCount(2);
  await expect(chips.nth(1).locator('.chip-flip')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cal-day.day-maybe')).toHaveCount(1);

  // Zooming in, the if needed day's mornings, afternoons and evenings are if needed; and back out.
  await page.click('[data-level="parts"]');
  await expect(page.locator('.pg-cell.part.on.maybe')).toHaveCount(3);
  await expect(page.locator('.pg-cell.part.on:not(.maybe)')).toHaveCount(isMobile ? 0 : 3); // phones show a day at a time
  await expect(page.locator('#free-list .chip.maybe')).toHaveCount(3);
  await page.click('[data-level="hours"]');
  await expect(page.locator('#free-list .od-row').first().locator('.chip.maybe')).toHaveCount(2);
  await expect(page.locator('#free-list .chip:not(.maybe)')).toHaveCount(2);
  await page.click('[data-level="days"]');
  await expect(page.locator('.cal-day.day-maybe')).toHaveCount(1);
  await expect(day(0)).toHaveClass(/day-maybe/);

  // Created, the organizer's answer says so.
  const answer = async () => {
    await openNewPoll(page);
    const id = page.url().split('/e/')[1];
    const token = await page.evaluate((id) => JSON.parse(localStorage.getItem(`venn:${id}`)).adminToken, id);
    const ev = await (await request.get(`/api/events/${id}`, { headers: { 'x-admin-token': token } })).json();
    return ev.slots.map((s) => ev.participants[0].availability[s]);
  };
  await page.click('#submit');
  expect(await answer()).toEqual([1, 2]);

  // Painted hours too: a week of mornings, if needed.
  await page.goto('/new/free');
  await page.fill('#title', 'Coffee');
  await page.click('[data-level="hours"]');
  await page.click('[data-fbrush="1"]');
  await page.click('[data-fill="0"]');
  await expect(page.locator('#free-list .chip.maybe').first()).toBeVisible();
  await expect(page.locator('#free-list .chip:not(.maybe)')).toHaveCount(0);
  await page.click('#submit');
  const hours = await answer();
  expect(hours.length).toBeGreaterThan(0);
  expect(new Set(hours)).toEqual(new Set([1]));
});

test('month calendars open on next month near the end of this one, and quick picks show their month', async ({ page }) => {
  const shown = () => page.locator('.cal-day').first().getAttribute('data-date');
  // January 28: four days left, so February is where the choosing is.
  await page.clock.setFixedTime(new Date(2030, 0, 28, 12));
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  expect(await shown()).toBe('2030-02-01');
  await expect(page.locator('[data-nav="-1"]')).toBeEnabled(); // January is still there
  // January 20: most of the month is left.
  await page.clock.setFixedTime(new Date(2030, 0, 20, 12));
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  expect(await shown()).toBe('2030-01-01');
  // The next two weeks are mostly in January; four weekends mostly in February.
  await page.click('#q-2w');
  expect(await shown()).toBe('2030-01-01');
  await page.click('#q-weekends');
  expect(await shown()).toBe('2030-02-01');
});

test('ask when people are free: paint hours and see the best time', async ({ page, isMobile }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Book club');
  await page.click('[data-level="hours"]');
  await page.click('[data-flength="60"]');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'true');
  // The quick fills are the same mornings, afternoons and evenings as the parts of the day.
  await expect(page.locator('[data-fill="2"]')).toContainText('Evenings 6 – 10 PM');
  await page.click('[data-fill="0"]'); // mornings, all week
  await expect(page.locator('#free-list')).toContainText('9 AM – 12 PM');
  await page.click('#submit');
  await expect(page.locator('#panel-mine h2')).toHaveText('When are you available?');
  // Phones start with parts of the day, the quickest way on a small screen; exact times are one tap away.
  // With a mouse, it's exact times.
  await expect(page.locator(`[data-hview="${isMobile ? 'quick' : 'exact'}"]`)).toHaveAttribute('aria-checked', 'true');
  if (isMobile) await expect(page.locator('#quick-hours .part-vote').first()).toBeVisible();
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
  await submit(page);
  await expect(page.locator('.best-hero')).toContainText('Works for the one person so far');
});

test('page never scrolls sideways', async ({ page }) => {
  await startPick(page, 'Width check', [600, 780, 1140]);
  await page.click('#submit');
  await page.click('#fill');
  await page.fill('#name', 'Sam');
  await submit(page);
  await expect(page.locator('.matrix')).toBeVisible();
  // Against the device's width: on a phone, content that's too wide makes the browser zoom out instead.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - screen.width);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('unknown poll shows a friendly error', async ({ page }) => {
  await page.goto('/e/doesnotexist');
  await expect(page.getByRole('heading', { name: 'Poll not found' })).toBeVisible();
});

test('poll links get their own preview in chat apps, before and after the date is picked', async ({ page, request }) => {
  const day = await nextMonth(page);
  const created = await request.post('/api/events', {
    data: {
      title: 'Dinner at <Finn’s>',
      emoji: '🍝',
      organizer: 'Priya',
      timezone: 'America/New_York',
      dates: [day],
      startMinute: 1140,
      endMinute: 1200,
      slotMinutes: 30,
      durationMinutes: 60,
    },
  });
  const { id, adminToken } = await created.json();
  // Link-preview crawlers don't run scripts: the tags are in the HTML the server sends.
  const tags = async () => {
    const html = await (await request.get(`/e/${id}`)).text();
    const meta = (key) => new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html)?.[1];
    return {
      title: /<title>(.*?)<\/title>/.exec(html)[1],
      ogTitle: meta('og:title'),
      description: meta('og:description'),
      image: meta('og:image'),
    };
  };
  let t = await tags();
  expect(t.title).toBe('🍝 Dinner at &lt;Finn’s&gt; · Venn');
  expect(t.ogTitle).toBe('🍝 Dinner at &lt;Finn’s&gt;');
  expect(t.description).toBe('Priya asks: when works for you? Tap your answers. No sign-up.');
  expect(t.image).toMatch(/^http:\/\/localhost:\d+\/og\.png$/);

  const ev = await (await request.get(`/api/events/${id}`)).json();
  await request.post(`/api/events/${id}/participants`, {
    data: { name: 'Lee', availability: { [ev.slots[0]]: 2, [ev.slots[1]]: 2 } },
  });
  await request.post(`/api/events/${id}/finalize`, { data: { start: ev.slots[0] }, headers: { 'x-admin-token': adminToken } });
  t = await tags();
  expect(t.description).toMatch(/^It&#39;s set: \w{3}, \w{3} \d{1,2}, 7:00 PM E[SD]T · 1 of 1 can make it$/);
  expect(t.image).toMatch(/\/og-set\.png$/);
  const image = await request.get(new URL(t.image).pathname);
  expect(image.headers()['content-type']).toBe('image/png');

  // The app still starts as usual on top of it.
  await page.goto(`/e/${id}`);
  await expect(page.locator('.banner-final')).toContainText("It's happening");
  await expect(page).toHaveTitle('Dinner at <Finn’s> · Venn');
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
  await submit(page);
  await expect(page.locator('#save-err')).toContainText('Add your name');
  await page.fill('#name', 'Priya Shah');
  await submit(page);
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
  await submit(page);
  await expect(page.locator('#save-state')).toHaveText('Submitted');
  // A guest who answered is offered a poll of their own.
  await expect(page.locator('#grow')).toBeVisible();
  await expect(page.locator('#grow a')).toHaveAttribute('href', '/new');
});

test('organizers add different times on different days, and see the whole poll before creating it', async ({ page }) => {
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');
  // Create stays greyed out until the poll has a name and an option, and says what's missing first.
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#summary')).toHaveText('Give your poll a name to create the poll (and 1 more thing)');
  await expect(page.locator('#options-list')).toContainText('Nothing yet');
  // It can still be reached and pressed: it says what's missing, and goes there.
  await page.locator('#submit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#err')).toHaveText('Give your poll a name to create the poll (and 1 more thing)');
  await expect(page.locator('#title')).toBeFocused();
  await expect(page).toHaveURL(/\/new\/pick$/);
  await page.fill('#title', 'Dinner');
  await expect(page.locator('#summary')).toHaveText('Add at least one option to create the poll');
  await page.locator('#submit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#err')).toHaveText('Add at least one option to create the poll');

  // Options appear as soon as there's a day and a time.
  await addOptions(page, 2, [1140]);
  await expect(page.locator('#options-list .chip')).toHaveCount(2);
  await expect(page.locator('#err')).toBeEmpty();
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');

  // Another time on the first day.
  const first = await nextMonth(page);
  await tapAt(page, first, 750);
  await expect(page.locator('#options-list .od-row').first().locator('.chip')).toHaveCount(2);
  await expect(page.locator('#options-list .od-row').nth(1).locator('.chip')).toHaveCount(1);
  await expect(page.locator('#options-list .chip')).toHaveCount(3);

  // An option's × on the calendar removes it.
  const second = await showDate(page, addDays(first, 1));
  await second.locator('.tg-block').hover();
  await expect(second.getByRole('button', { name: /^Remove 7 – 8 PM, / })).toBeVisible();
  await second.locator('.tg-x').click();
  await expect(page.locator('#options-list .od-row')).toHaveCount(1);
  await page.click('#submit');
  await expect(page.locator('#mine .row')).toHaveCount(2);
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
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 2, [1140]);
  // Times and whole days don't mix, so switching to all day would clear them: saying no keeps both.
  let asked = answer(false);
  await page.click('[data-length="allday"]');
  expect(await asked).toBe("Switching to all day removes the 2 options you've added. Switch anyway?");
  await expect(page.locator('[data-length="60"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-length="allday"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#options-list .chip')).toHaveCount(2);
  asked = answer(true);
  await page.click('[data-length="allday"]');
  await asked;
  await expect(page.locator('#options-list')).toContainText('Nothing yet');

  // On "ask when people are free", one × can stand for a week of evenings.
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.click('#q-2w');
  await page.click('[data-level="parts"]');
  await expect(page.locator('[data-level="parts"]')).toHaveAttribute('aria-checked', 'true'); // the painter loads first
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
  await page.fill('#organizer', 'Sam');
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
  await page.fill('#organizer', 'Sam');
  await expect(page.locator('#tz-box summary')).toHaveText(`Times in ${await zoneName(local)} · Change`);
});

test('phone: no zoom on focus, tap targets, tap-to-pick dates, Save always in reach', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone-only behaviour');
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');

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
  await page.locator('.tg-x').tap(); // its × removes it
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
  // Answering one shows Save in reach, and how far along the answer is.
  await expect(page.locator('#save-state')).toContainText('1 of 21 answered');
  const save = await page.locator('#save').boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(page.viewportSize().height);
});

test('the week calendar opens at the plan’s time and pages a week at a time', async ({ page, isMobile }) => {
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');
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

  // On a phone, the day view shows a day of that week, and the next week is still one tap away.
  await page.click('[data-view="day"]');
  const picked = page.locator('#picker .tv-chip[aria-pressed="true"]');
  const day = await picked.getAttribute('data-day');
  expect(day >= addDays(first, 7) && day <= addDays(first, 13)).toBe(true);
  await next.click();
  await expect(picked).toHaveAttribute('data-day', addDays(day, 7));
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
  await page.fill('#organizer', 'Sam');
  await page.locator('#picker .tv-pick').waitFor(); // drawn again once day-nav.js is in
  expect((await page.locator('.tg-scroll').boundingBox()).height).toBeLessThanOrEqual(half);
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.click('[data-level="hours"]');
  const hours = page.locator('#when .tg-scroll');
  expect((await hours.boundingBox()).height).toBeLessThanOrEqual(half);
  // The hint comes before the calendar, not after it.
  const help = page.locator('#when-help');
  await expect(help).toHaveText('Tap the calendar to add an option for your date range.');
  expect((await help.boundingBox()).y).toBeLessThan((await hours.boundingBox()).y);
});

test('keyboard: add a time to "vote on a few dates" without the pointer', async ({ page }) => {
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Book club');
  await page.click('#other-box summary');
  await page.selectOption('#custom', '90'); // Custom, 1½ hours
  // Pressing Create with no options goes to the day to add one.
  await page.locator('#submit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#at-day')).toBeFocused();
  await page.getByRole('button', { name: 'Next week' }).click();
  const day = await page.locator('#picker .tg-col').first().getAttribute('data-date');
  await expect(page.locator('#at-day')).toHaveValue(day); // the day follows the calendar
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

test('phones and touch screens open the calendar on one day, with Week a tap away', async ({ page, browser, isMobile }) => {
  await page.goto('/new/pick');
  await expect(page.locator('#picker [data-view="day"]')).toHaveAttribute('aria-checked', String(isMobile));
  await expect(page.locator('#picker .tg-col')).toHaveCount(isMobile ? 1 : 7);
  await page.click('#picker [data-view="week"]');
  await expect(page.locator('#picker .tg-col')).toHaveCount(7);
  // A tablet, or a big phone on its side: a touch screen wider than a phone opens on Day too.
  const tablet = await browser.newContext({ viewport: { width: 900, height: 700 }, hasTouch: true });
  const tab = await tablet.newPage();
  await tab.goto(new URL('/new/pick', page.url()).href);
  await expect(tab.locator('#picker [data-view="day"]')).toHaveAttribute('aria-checked', 'true');
  await expect(tab.locator('#picker .tg-col')).toHaveCount(1);
  await tablet.close();
});

test('the day strip scrolls through the months ahead; › goes a week and » 30 days', async ({ page, isMobile }) => {
  await page.goto('/new/pick');
  const today = await todayIn(page);
  if (!isMobile) await page.click('#picker [data-view="day"]');
  const strip = page.locator('#picker .tv-strip');
  const picked = strip.locator('[aria-pressed="true"]');
  const shown = page.locator('#picker .tg-col');
  await expect.poll(() => strip.locator('.tv-chip').count()).toBeGreaterThan(180); // about six months
  await expect(strip.locator('.tv-chip').first()).toHaveAttribute('data-day', today);
  await expect(picked).toHaveAttribute('data-day', today);
  // It scrolls inside itself, never the page.
  const [scrollW, clientW, pageW, viewW] = await strip.evaluate((el) => [
    el.scrollWidth,
    el.clientWidth,
    document.documentElement.scrollWidth,
    innerWidth,
  ]);
  expect(scrollW).toBeGreaterThan(clientW * 10);
  expect(pageW).toBeLessThanOrEqual(viewW);
  // A swipe scrolls the strip and leaves the day alone.
  await strip.scrollIntoViewIfNeeded();
  const box = await strip.boundingBox();
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    const y = Math.round(box.y + box.height / 2);
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x == null ? [] : [{ x, y }] });
    let x = Math.round(box.x + box.width - 30);
    await touch('touchStart', x);
    for (let i = 0; i < 10; i++) await touch('touchMove', (x -= 25));
    await touch('touchEnd');
  } else await strip.evaluate((el) => el.scrollBy(250, 0));
  await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  await expect(picked).toHaveAttribute('data-day', today);
  await expect(shown).toHaveAttribute('data-date', today);
  // A tap on a day picks it.
  const later = addDays(today, 20);
  await strip.locator(`[data-day="${later}"]`).click();
  await expect(picked).toHaveAttribute('data-day', later);
  await expect(shown).toHaveAttribute('data-date', later);
  // » skips 30 days and « goes back; ‹ › still go a week. The day shown stays in view in the strip.
  await page.getByRole('button', { name: 'Forward 30 days' }).click();
  await expect(shown).toHaveAttribute('data-date', addDays(later, 30));
  const inView = async () => {
    const [c, s] = [await picked.boundingBox(), await strip.boundingBox()];
    return c.x >= s.x - 1 && c.x + c.width <= s.x + s.width + 1;
  };
  await expect.poll(inView).toBe(true);
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(picked).toHaveAttribute('data-day', addDays(later, 37));
  await expect.poll(inView).toBe(true);
  await page.getByRole('button', { name: 'Back 30 days' }).click();
  await expect(picked).toHaveAttribute('data-day', addDays(later, 7));
  // An option shows on its day's chip.
  await tapAt(page, addDays(later, 7), 1140);
  await expect(picked.locator('i')).toHaveText('1');
  // Not before today: « goes back to today, then it's off.
  await page.getByRole('button', { name: 'Back 30 days' }).click();
  await expect(picked).toHaveAttribute('data-day', today);
  await expect(page.getByRole('button', { name: 'Back 30 days' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeDisabled();
});

test('the date heading opens a month, to jump to any day ahead', async ({ page, isMobile }) => {
  await page.goto('/new/pick');
  const today = await todayIn(page);
  const heading = page.getByRole('button', { name: /jump to a day/ });
  const jump = page.locator('#jump');
  await expect(jump).toBeHidden();
  await heading.click();
  await expect(jump).toBeVisible();
  // The keyboard goes to the calendar; days gone by are off.
  await expect(jump.locator('.cal-day:focus')).toHaveCount(1);
  await expect(jump.locator(`[data-date="${today}"]`)).toBeEnabled();
  if (!today.endsWith('-01')) await expect(jump.locator(`[data-date="${addDays(today, -1)}"]`)).toBeDisabled();
  // Three months on, in a few taps.
  for (let i = 0; i < 3; i++) await jump.locator('[data-nav="1"]').click();
  const target = await jump.locator('.cal-day').nth(9).getAttribute('data-date');
  await jump.locator(`[data-date="${target}"]`).click();
  await expect(jump).toBeHidden();
  await expect(page.locator(`#picker .tg-col[data-date="${target}"]`)).toHaveCount(1);
  await expect(page.locator('#picker .tg-col')).toHaveCount(isMobile ? 1 : 7); // the day, or its week
  if (isMobile) {
    await expect(page.locator('#picker .tv-chip[aria-pressed="true"]')).toHaveAttribute('data-day', target);
    await expect(heading).toContainText(new Date(`${target}T12:00:00Z`).getUTCDate().toString());
  }
  // It opens on the day shown; Escape, or a tap elsewhere, closes it.
  await heading.click();
  if (isMobile) await expect(jump.locator(`[data-date="${target}"]`)).toHaveAttribute('aria-current', 'date');
  else await expect(jump.locator(`[data-date="${target}"]`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(jump).toBeHidden();
  await expect(heading).toBeFocused();
  await heading.click();
  await page.mouse.click(5, 5);
  await expect(jump).toBeHidden();
});

test('"Or add a time" adds an option on any day ahead, and the calendar goes there', async ({ page }) => {
  await page.goto('/new/pick');
  await page.fill('#title', 'Book club');
  const today = await todayIn(page);
  const day = page.locator('#at-day');
  await expect(day).toHaveAttribute('type', 'date');
  await expect(day).toHaveAttribute('min', today);
  await expect(day).toHaveValue(today); // the day the calendar shows
  await expect(day).toHaveCSS('font-size', '16px');
  // A day six weeks on: the calendar goes to it, and Add puts the option there.
  const far = addDays(today, 45);
  await day.fill(far);
  await expect(page.locator(`#picker .tg-col[data-date="${far}"]`)).toHaveCount(1);
  await page.selectOption('#at-time', '1140');
  await page.click('#at-add');
  await expect(page.locator('#options-list .chip')).toHaveCount(1);
  await expect(page.locator(`#picker .tg-col[data-date="${far}"] .tg-block`)).toHaveCount(1);
  // The day follows the calendar when it moves.
  await page.getByRole('button', { name: 'Forward 30 days' }).click();
  const shown = await page.locator('#picker .tg-col').first().getAttribute('data-date');
  await expect(day).toHaveValue(shown);
  // A day gone by isn't added.
  await day.fill(addDays(today, -2));
  await page.click('#at-add');
  await expect(page.locator('#options-list .chip')).toHaveCount(1);
  await expect(day).toBeFocused();
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
    .getByRole('link', { name: /Ask when people are available/ })
    .click();
  await expect(page).toHaveURL(/\/new\/free$/);
  await expect(page.locator('#title')).toBeVisible();
  await page.goto('/');
  await page
    .locator('.start-cards')
    .getByRole('link', { name: /Vote on a few dates/ })
    .click();
  await expect(page).toHaveURL(/\/new\/pick$/);
  await expect(page.locator('#title')).toHaveAttribute('placeholder', "Dinner at Rosa's");
  // /new (linked from the privacy and 404 pages) still offers both kinds of poll.
  await page.goto('/new');
  await expect(page.getByRole('heading', { name: 'What kind of poll?' })).toBeVisible();
  await page.getByRole('link', { name: 'Venn', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('the poll created celebration shows the dog; Share poll copies the link and opens the poll', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');
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
    await submit(g);
    await expect(g.locator('#save-err')).toHaveText(/Add your email/);
    await g.fill('#copy-to', email);
    await submit(g);
    await expect(g.locator('#save-state')).toHaveText('Submitted');
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
  await page.fill('#organizer', 'Sam');
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
  await page.fill('#organizer', 'Sam');
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
  await submit(page);
  await expect(page.locator('#save-err')).toHaveText(/Check your email address/);
  await expect(page.locator('#copy-to')).toBeFocused();
  await expect(page.locator('#copy-to')).toHaveAttribute('aria-invalid', 'true');
  await page.fill('#copy-to', 'marcus@example.com');
  // Every dialog in these tests is accepted: answering again as a new person is still allowed.
  const asked = page.waitForEvent('dialog');
  await submit(page);
  expect((await asked).message()).toContain('Someone called Marcus has already answered');
  await expect(page.locator('#save-state')).toHaveText('Submitted');
});

test("the organizer link on another device finds the organizer's own answer", async ({ page, browser }) => {
  await startPick(page, 'Dinner', [1140]);
  await page.click('#submit');
  await openNewPoll(page);
  // The organizer answers on this device.
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await submit(page);
  const url = page.url();
  const token = await page.evaluate((id) => JSON.parse(localStorage.getItem(`venn:${id}`)).adminToken, url.split('/e/')[1]);
  const other = await (await browser.newContext()).newPage();
  await other.goto(`${url}#admin=${token}`);
  await expect(other.locator('#edit-link')).toContainText('Answering as Sam.');
  await expect(other.locator('#edit-link')).not.toContainText('personal link');
  if (await other.locator('#tab-mine').isVisible()) await other.click('#tab-mine');
  await other.locator('#mine .row').first().locator('[data-vote="0"]').click();
  await submit(other);
  await expect(other.locator('#save-state')).toHaveText('Submitted');
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
  await page.click('#sc-yes');
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
  await page.fill('#organizer', 'Sam');
  await expect(page.locator('#ai-draft')).toBeVisible();
  await page.fill('#ai-prompt', '45 minute design review, afternoons later this week');
  await page.click('#ai-go');
  await expect(page.locator('#toast')).toContainText('Filled in 3 options');
  await expect(page.locator('#title')).toHaveValue('Design review');
  await expect(page.locator('#custom')).toHaveValue('45');
  await expect(page.locator('#other-box summary')).toHaveText('Custom · 45 min, selected');
  const picked = page.locator('#options-list .chip');
  await expect(picked).toHaveCount(3);
  await expect(picked.first()).toContainText('2:00 – 2:45 PM');

  await page.click('#submit');
  await expect(page.locator('#mine .row')).toHaveCount(3);
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await page.fill('#name', 'Sam');
  await submit(page);
  await expect(page.locator('#save-state')).toHaveText('Submitted');

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
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Drinks');
  // Drawing on a week is where it starts.
  await expect(page.locator('[data-view="week"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('.tv-nav [data-step="1"]'); // next week, so every day is in the future
  await page.locator('.tg-scroll').evaluate((el) => el.scrollIntoView({ block: 'center' })); // clear of the sticky bar
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
  await part(0).click(); // available
  await part(1).click();
  await part(1).click(); // if needed
  await expect(part(0)).toHaveAttribute('data-v', '2');
  await expect(part(1)).toHaveAttribute('data-v', '1');
  await expect(part(1)).toHaveAttribute('aria-pressed', 'mixed');
  await page.fill('#name', 'Sam');
  await submit(page);
  await expect(page.locator('.best-hero')).toContainText('afternoon (12 – 5 PM)');
  // Everyone's answers are colour-coded: available, if needed and unavailable, with a key.
  const heat = page.locator('.heat-btn');
  await expect(heat.nth(0).locator('.heat-bar i')).toHaveClass(['y']);
  await expect(heat.nth(1).locator('.heat-bar i')).toHaveClass(['m']);
  await expect(heat.nth(2).locator('.heat-bar i')).toHaveClass(['n']);
  await expect(heat.nth(2)).toHaveAccessibleName(/1 unavailable/);
  await expect(page.locator('.legend')).toContainText('Unavailable');
  await heat.first().click();
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

test("organizers drag an option's edge to resize it", async ({ page, isMobile }) => {
  test.skip(isMobile, 'drag with a mouse');
  await page.goto('/new/pick');
  await page.fill('#title', 'Dinner');
  await page.fill('#organizer', 'Sam');
  await page.click('.tv-nav [data-step="1"]');
  const grid = await page.locator('.tg-scroll').boundingBox();
  const col = async (i) => page.locator('.tg-col').nth(i).boundingBox();
  // Two one-hour options (the default length).
  await page.mouse.click((await col(1)).x + 10, grid.y + 10);
  await page.mouse.click((await col(3)).x + 10, grid.y + 10);
  await expect(page.locator('.tg-block')).toHaveCount(2);
  // Tapping an option does nothing to it: picking times only proposes them.
  await page.locator('.tg-block').first().click();
  await expect(page.locator('.tg-block')).toHaveCount(2);

  // Drag the first option's bottom edge down two rows: an hour becomes 2.
  const first = page.locator('.tg-block').first();
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
    await page.click('[data-hview="quick"]'); // already chosen on phones
    const quick = (d, k) => page.locator(`[data-quick="${d}|${k}"]`);
    await expect(quick('2030-01-08', 'all')).toBeVisible();
    await quick('2030-01-08', 'morning').click(); // available all morning
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
    // Submit asks first, showing who's answering and what; Go back changes nothing.
    await page.click('#save');
    const check = page.locator('#submit-check');
    await expect(check).toBeVisible();
    await expect(check.locator('h2')).toHaveText('Submit your answer?');
    await expect(check).toContainText('Answering as Ana.');
    await expect(check.locator('.chip').first()).toBeVisible();
    await expect(check.locator('#sc-yes')).toBeFocused();
    await check.locator('#sc-no').click();
    await expect(check).toBeHidden();
    await expect(page.locator('#save-state')).toContainText('Not submitted yet');
    // Then Submit sends it, with the same celebration organizers get.
    await page.click('#save');
    await check.locator('#sc-yes').click();
    await expect(page.locator('.party [role=status]')).toContainText(/Answer submitted!.*Sam can see it now/);
    await expect(page.locator('.party-hero img')).toHaveCount(1);
    await expect(page.locator('.party')).toHaveCount(0, { timeout: 10_000 }); // it goes by itself
    await expect(page.locator('#save')).toHaveText('Submit');
    await expect(page.locator('#save-state')).toHaveText('Submitted');
    // Changing it later says so. (Phones show the group after the first answer; go back to yours.)
    if (await page.locator('#tab-mine').isVisible()) await page.click('#tab-mine');
    await page.click('#save');
    await expect(check).toContainText('This replaces your last answer.');
    await check.locator('#sc-yes').click();
    await expect(page.locator('.party [role=status]')).toContainText('Answer updated!');
    await page.click('.party-go');
  });
});

test('organizers add hours on different days, drag them longer, switch one to if needed, and guests mark within them', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'drag with a mouse; phones are covered by the quick fills');
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Drinks');
  await page.click('[data-level="hours"]');
  await page.click('[data-flength="60"]');
  await page.click('#when .tv-nav [data-step="1"]'); // next week, so every day is in the future
  const col = (i) => page.locator('#when .tg-col').nth(i);
  // Where a time is in a day's column, scrolled into view.
  const at = (i, minutes, scroll = true) =>
    col(i).evaluate(
      (el, [m, scroll]) => {
        const row = parseFloat(getComputedStyle(el.closest('.tg')).getPropertyValue('--row')) || 24;
        if (scroll) {
          el.closest('.tg-scroll').scrollIntoView({ block: 'center' });
          el.closest('.tg-scroll').scrollTop = ((m - 420) / 30) * row - 2 * row;
        }
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + ((m - 420) / 30) * row + row / 2 };
      },
      [minutes, scroll],
    );
  const tap = async (i, m) => {
    const p = await at(i, m);
    await page.mouse.click(p.x, p.y);
  };
  const dragBy = async (target, dy) => {
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy, { steps: 4 });
    await page.mouse.up();
  };
  // A tap adds a time of the length chosen: 7 – 9 PM on the first two days, 10 – 11 AM on the third.
  await page.click('[data-flength="120"]');
  await tap(0, 1140);
  await tap(1, 1140);
  await page.click('[data-flength="60"]');
  await tap(2, 600);
  const blocks = page.locator('#when .tg-block');
  await expect(blocks).toHaveCount(3);
  const list = page.locator('#free-list .od-row');
  await expect(list).toHaveCount(2); // the same evening on two days in a row is one row
  await expect(list.first()).toContainText('7 – 9 PM');
  await expect(list.nth(1)).toContainText('10 – 11 AM');
  // Drag the morning's bottom edge down two rows: 10 – 11 becomes 10 – 12.
  await dragBy(page.locator('#when .tg-col').nth(2).locator('.tg-bottom'), 48);
  await expect(list.nth(1)).toContainText('10 AM – 12 PM');
  // Drag the second evening down an hour: it moves to 8 – 10 PM.
  await at(1, 1140); // scroll the evening into view
  await dragBy(page.locator('#when .tg-col').nth(1).locator('.tg-block'), 48);
  await expect(list).toHaveCount(3);
  await expect(list.nth(1)).toContainText('8 – 10 PM');
  await page.click('#submit');

  // Guests get a grid with just those hours: 4 + 4 + 4 half hours.
  await expect(page.locator('#mine .cell[data-slot]')).toHaveCount(12);
  await expect(page.locator('#ev-details')).toContainText('Looking for 1 hour');
});

test('ask when people are free: zoom from whole days to parts of the day to hours', async ({ page, isMobile }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Picnic');
  await showNextMonth(page);
  for (const i of [0, 1]) await page.locator('.cal-day').nth(i).click();
  await expect(page.locator('#summary')).toHaveText('2 days to choose from');

  // Parts of the day keeps the days, with mornings, afternoons and evenings on a calendar.
  await page.click('[data-level="parts"]');
  await expect(page.locator('#summary')).toHaveText('6 times to choose from');
  await expect(page.locator('.pg-cell.part.on')).toHaveCount(isMobile ? 3 : 6); // phones show a day at a time
  // A tap makes the first day's morning if needed for the organizer; another takes it away.
  const morning = page.locator('.pg-cell.part[data-r="0"][data-c="0"]');
  await morning.click();
  await expect(morning).toHaveClass(/maybe/);
  await expect(morning.locator('.pg-tag')).toHaveText('If needed');
  await morning.click();
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

// ---------- the picked date, sharing, and answering one way at a time ----------

/** A "vote on a few dates" poll made through the API, opened as its organizer. */
async function organizerPoll(page, request, { picked = false, answered = false } = {}) {
  const options = [8, 9].map((d) => ({ start: Date.UTC(2030, 0, d, 18), end: Date.UTC(2030, 0, d, 20) }));
  const { id, adminToken } = await (
    await request.post('/api/events', { data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options } })
  ).json();
  if (answered)
    await request.post(`/api/events/${id}/participants`, { data: { name: 'Lee', availability: { [options[0].start]: 2 } } });
  if (picked)
    await request.post(`/api/events/${id}/finalize`, {
      data: { start: options[0].start },
      headers: { 'x-admin-token': adminToken },
    });
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('#ev-title')).toHaveText('Dinner');
  return id;
}

test('once the date is picked: add it to Google Calendar, Outlook or iCal', async ({ page, request }) => {
  const id = await organizerPoll(page, request, { picked: true });
  const group = page.getByRole('group', { name: 'Add to your calendar' });
  await expect(group).toContainText('Opens your calendar with the event filled in');
  const links = group.getByRole('link');
  await expect(links).toHaveCount(3);
  for (const [i, name] of ['Google Calendar', 'Outlook', 'iCal'].entries()) await expect(links.nth(i)).toHaveAccessibleName(name);
  // Each has its logo, drawn in the page and hidden from screen readers: the name says which it is.
  await expect(group.locator('svg[aria-hidden="true"]')).toHaveCount(3);
  await expect(group.locator('img')).toHaveCount(0);

  const google = group.getByRole('link', { name: 'Google Calendar', exact: true });
  await expect(google).toHaveAttribute('href', /^https:\/\/calendar\.google\.com\/.*text=Dinner/);
  await expect(google).toHaveAttribute('target', '_blank');
  const outlook = group.getByRole('link', { name: 'Outlook', exact: true });
  await expect(outlook).toHaveAttribute('href', /^https:\/\/outlook\.live\.com\//);
  await expect(outlook).toHaveAttribute('target', '_blank');

  // iCal is the .ics file, which Apple Calendar and most other calendars open.
  const [download] = await Promise.all([page.waitForEvent('download'), group.getByRole('link', { name: 'iCal' }).click()]);
  expect(download.suggestedFilename()).toBe(`${id}.ics`);
  const ics = await (await request.get(`/api/events/${id}/event.ics`)).text();
  expect(ics).toContain('SUMMARY:Dinner');
  expect(ics).toContain('DTSTART:20300108T180000Z');

  // Sharing and clearing the date are still there, below.
  const banner = page.locator('.banner-final');
  await expect(banner.locator('.final-more [data-share]')).toBeVisible();
  await banner.getByRole('button', { name: 'Clear the date' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Add to your calendar' })).toHaveCount(0);
});

test('a date picked while the poll is open shows "Add to your calendar" straight away', async ({ page, request }) => {
  await organizerPoll(page, request, { answered: true });
  await page.locator('.best-hero [data-pick]').click();
  await expect(page.getByRole('group', { name: 'Add to your calendar' }).getByRole('link')).toHaveCount(3);
});

test('every share and copy of the poll is just its link, with nothing else around it', async ({ page, request, isMobile }) => {
  // Catch what the share sheet and the clipboard are given.
  await page.addInitScript(() => {
    window.shared = [];
    navigator.share = async (data) => void window.shared.push(data);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text) => void window.shared.push({ copied: text }) },
    });
  });
  const id = await organizerPoll(page, request, { picked: true });
  const url = `${new URL(page.url()).origin}/e/${id}`;
  await page.click('#copy'); // the header's Share / Copy invite link
  await page.locator('.banner-final [data-share]').click(); // "Share the date"
  if (isMobile) await page.click('#tab-group');
  await page.locator('#best [data-share]').click(); // "Share the poll", while nobody has answered
  const shared = await page.evaluate(() => window.shared);
  expect(shared).toHaveLength(3);
  // Phones get the share sheet with the title and link only, so its Copy copies the bare link.
  for (const s of shared) expect(s).toEqual(isMobile ? { title: 'Dinner', url } : { copied: url });

  // The organizer's private link is the only one with a secret in it, and it says so.
  if (!(await page.locator('#copy-admin').isVisible())) await page.locator('details.organizer summary').click();
  await page.click('#copy-admin');
  const admin = (await page.evaluate(() => window.shared)).at(-1);
  expect(admin.copied).toMatch(new RegExp(`^${url}#admin=\\w+`));
  await expect(page.locator('#toast')).toContainText('Keep it private');
});

test('parts of the day: "All day" marks every part of a day in one tap', async ({ page, request }) => {
  const day = (d, h) => Date.UTC(2030, 0, d, h);
  const options = [8, 9].flatMap((d) => [
    { start: day(d, 9), end: day(d, 12) },
    { start: day(d, 12), end: day(d, 17) },
    { start: day(d, 18), end: day(d, 22) },
  ]);
  const { id } = await (
    await request.post('/api/events', { data: { title: 'Coffee', timezone: 'UTC', mode: 'options', layout: 'parts', options } })
  ).json();
  await page.goto(`/e/${id}`);
  await expect(page.locator('#panel-mine .hint').first()).toHaveText('Tap to switch: available, if needed, unavailable.');
  const allDay = page.getByRole('button', { name: /^All day\W+Tue, Jan 8$/ });
  const parts = page.locator('.parts-row').first().locator('.part-vote');
  await expect(allDay).toHaveAttribute('aria-pressed', 'false');
  await allDay.click();
  await expect(parts.filter({ hasText: '✓ Available' })).toHaveCount(3);
  await expect(allDay).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#my-picks')).toContainText('3 yes');
  // Tap again for "if needed", and once more for unavailable, in red.
  await allDay.click();
  await expect(page.locator('.parts-row').first().locator('.part-vote[data-v="1"]')).toHaveCount(3);
  await expect(allDay).toHaveAttribute('aria-pressed', 'mixed');
  await allDay.click();
  const no = page.locator('.parts-row').first().locator('.part-vote[data-v="no"]');
  await expect(no).toHaveCount(3);
  await expect(no.first()).toContainText('✕ Unavailable');
  await expect(allDay).toHaveAttribute('data-v', 'no');
  const red = await no.first().evaluate((el) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--no)';
    document.body.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(el).backgroundColor === want;
  });
  expect(red).toBe(true);
  // It's a shortcut: the answer is saved as the parts themselves.
  await allDay.click();
  await parts.nth(2).click(); // the evening becomes "if needed"
  await expect(allDay).toHaveAttribute('aria-pressed', 'false');
  await page.fill('#name', 'Ana');
  await submit(page);
  await expect(page.locator('#save')).toHaveText('Submit', { timeout: 10_000 });
  const ev = await (await request.get(`/api/events/${id}`)).json();
  expect(ev.participants[0].availability).toEqual({
    [options[0].start]: 2,
    [options[1].start]: 2,
    [options[2].start]: 1,
  });
});

test.describe('hours polls, in UTC', () => {
  test.use({ timezoneId: 'UTC' });
  test('guests answer with parts of the day or exact times, never both at once', async ({ page, request, isMobile }) => {
    const { id } = await (
      await request.post('/api/events', {
        data: {
          title: 'Brunch',
          timezone: 'UTC',
          dates: ['2030-01-08', '2030-01-09'],
          startMinute: 540,
          endMinute: 1260,
          slotMinutes: 30,
          durationMinutes: 60,
        },
      })
    ).json();
    page.removeAllListeners('dialog');
    const asked = [];
    let answer = false;
    page.on('dialog', (d) => (asked.push(d.message()), answer ? d.accept() : d.dismiss()));
    await page.goto(`/e/${id}`);
    const mode = page.getByRole('radiogroup', { name: 'Answer with' });
    await expect(mode.getByRole('radio')).toHaveText(['Parts of the day', 'Exact times']);
    // Phones start on parts of the day, the quickest; with a mouse, exact times.
    await expect(mode.getByRole('radio', { name: isMobile ? 'Parts of the day' : 'Exact times' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const quick = (d, k) => page.locator(`[data-quick="${d}|${k}"]`);
    const cells = page.locator('#mine .cell[data-slot]');

    // Exact times: one half hour. Parts of the day can't show that, so switching asks before clearing it.
    await page.click('[data-hview="exact"]');
    await expect(page.locator('#quick-hours')).toBeHidden();
    const cell = cells.nth(2);
    await cell.scrollIntoViewIfNeeded();
    if (isMobile) await cell.tap();
    else await cell.click();
    await expect(page.locator('#mine .cell.yes')).toHaveCount(1);
    await page.click('[data-hview="quick"]');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('Clear them');
    await expect(page.locator('[data-hview="exact"]')).toHaveAttribute('aria-checked', 'true'); // kept, as asked
    await expect(page.locator('#mine .cell.yes')).toHaveCount(1);
    answer = true;
    await page.click('[data-hview="quick"]');
    await expect(page.locator('#quick-hours')).toBeVisible();
    await expect(page.locator('#exact-hours')).toBeHidden();
    await expect(page.locator('#mine .cell.yes')).toHaveCount(0);
    await expect(page.locator('#my-picks')).toBeHidden();

    // Parts of the day, with "All day" for each day: a shortcut for all of its parts.
    await quick('2030-01-08', 'all').click();
    for (const k of ['morning', 'afternoon', 'evening']) await expect(quick('2030-01-08', k)).toHaveAttribute('data-v', '2');
    await expect(quick('2030-01-08', 'all')).toHaveAttribute('aria-pressed', 'true');
    await quick('2030-01-09', 'evening').click();
    await quick('2030-01-09', 'evening').click(); // if needed
    await expect(page.locator('#my-picks')).toContainText('Tue, Jan 8, 9 AM – 9 PM');
    await expect(page.locator('#my-picks')).toContainText('Wed, Jan 9, 5 – 9 PM');

    // To exact times keeps every time, and back again needs no question.
    await page.click('[data-hview="exact"]');
    if (isMobile) await expect(page.locator('#hour-days .tv-chip').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#mine .cell.yes')).toHaveCount(24); // all of Jan 8
    if (!isMobile) await expect(page.locator('#mine .cell.maybe')).toHaveCount(8); // 5 – 9 PM on Jan 9
    await page.click('[data-hview="quick"]');
    expect(asked).toHaveLength(2);
    await expect(quick('2030-01-09', 'evening')).toHaveAttribute('data-v', '1');

    // Saved as times, like any answer, and it comes back on parts of the day on a phone.
    await page.fill('#name', 'Ana');
    await submit(page);
    await expect(page.locator('#save')).toHaveText('Submit', { timeout: 10_000 });
    const ev = await (await request.get(`/api/events/${id}`)).json();
    expect(Object.values(ev.participants[0].availability).filter((v) => v === 2)).toHaveLength(24);
    expect(Object.values(ev.participants[0].availability).filter((v) => v === 1)).toHaveLength(8);
    await page.reload();
    await expect(page.locator(`[data-hview="${isMobile ? 'quick' : 'exact'}"]`)).toHaveAttribute('aria-checked', 'true');
  });
});

test('optional details sit under More details, placeholders make way on focus, and editing opens them', async ({ page }) => {
  await startPick(page, 'Dinner', [1140]);
  // Where and the note are optional, so they start folded away together.
  await expect(page.locator('#more-box')).not.toHaveAttribute('open', '');
  await expect(page.locator('#location')).toBeHidden();
  await page.getByText('More details').click();
  await expect(page.locator('#location')).toBeVisible();
  await expect(page.getByLabel('Note for everyone')).toBeVisible();
  // A placeholder disappears as soon as the cursor is in its box.
  const placeholder = (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el, '::placeholder').color);
  expect(await placeholder('#location')).not.toBe('rgba(0, 0, 0, 0)');
  await page.focus('#location');
  expect(await placeholder('#location')).toBe('rgba(0, 0, 0, 0)');
  await page.fill('#location', 'Rosa’s Trattoria');
  await page.fill('#desc', 'Bring a bottle');
  await page.click('#submit');
  await openNewPoll(page);
  await expect(page.locator('#ev-details')).toContainText('Rosa’s Trattoria');
  await expect(page.locator('#ev-details')).toContainText('Bring a bottle');
  // Editing the poll shows them again, open.
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('#more-box')).toHaveAttribute('open', '');
  await expect(page.locator('#location')).toHaveValue('Rosa’s Trattoria');
});

test('how long: 30 min, 1 hour, half day, all day, several days, and any other length under Custom', async ({ page }) => {
  await page.goto('/new/pick');
  const chips = page.locator('[data-length]');
  await expect(chips).toHaveText(['30 min', '1 hour', 'Half day', 'All day', 'Several days']);
  const other = page.locator('#other-box');
  // Dinner is two hours: Custom says so, but stays folded away so the chips aren't crowded.
  await page.click('[data-occasion="0"]');
  await expect(other).not.toHaveAttribute('open', '');
  await expect(other.locator('summary')).toHaveText('Custom · 2 hours, selected');
  // In use, Custom looks like a chosen chip.
  await expect(other).toHaveClass(/\bon\b/);
  const bg = await other.locator('summary').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe(await page.locator('[data-occasion="0"]').evaluate((el) => getComputedStyle(el).backgroundColor));
  await expect(page.locator('[data-length][aria-pressed="true"]')).toHaveCount(0);
  await other.locator('summary').click();
  await expect(page.getByLabel('Length', { exact: true })).toHaveValue('120');
  // Coffee is an hour, which has its own chip, and Custom folds away.
  await page.click('[data-occasion="2"]');
  await expect(page.locator('[data-length="60"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(other).not.toHaveAttribute('open', '');
  await expect(other.locator('summary')).toHaveText('Custom');
  await expect(other).not.toHaveClass(/\bon\b/);
  // Opening it uses the length it shows; choosing another one changes it.
  await other.locator('summary').click();
  await expect(page.locator('[data-length="60"]')).toHaveAttribute('aria-pressed', 'false');
  await page.selectOption('#custom', '180');
  await expect(other.locator('summary')).toHaveText('Custom · 3 hours, selected');
  await expect(page.locator('#custom option:checked')).toHaveText('3 hours');
  await addOptions(page, 1, [1080]);
  await expect(page.locator('#options-list .chip')).toContainText('6 – 9 PM');
});

test('half day: pick mornings, afternoons and evenings on days, and edit them again', async ({ page, request }) => {
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Book club');
  await page.click('[data-length="half"]');
  await expect(page.locator('.tg')).toHaveCount(0); // not the week of hours
  await page.click('#picker [data-pstep="1"]'); // next week
  const cell = (m) => page.locator(`#picker .pg-cell[data-c="0"][data-m="${m}"]`);
  await cell(540).click();
  await cell(1080).click();
  await cell(720).click();
  const opts = page.locator('#options-list .chip');
  await expect(opts).toHaveCount(3);
  await expect(opts.nth(0)).toContainText('Morning 9 AM – 12 PM');
  await expect(opts.nth(1)).toContainText('Afternoon');
  await expect(page.locator('#summary')).toHaveText('3 options to vote on');
  await page.click('#submit');
  await openNewPoll(page);
  const id = page.url().split('/e/')[1];
  const ev = await (await request.get(`/api/events/${id}`)).json();
  expect(ev.options.map((o) => (o.end - o.start) / 3_600_000)).toEqual([3, 5, 4]);
  // Back to edit: still half days.
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('[data-length="half"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(opts).toHaveCount(3);
  await expect(page.locator('#picker .pg-cell.on')).toHaveCount(3);
});

test('your name and email are at the bottom, required, and missing fields say so', async ({ page }) => {
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), email: true } });
  });
  await page.goto('/new/free');
  // Both in "About you", the name directly above the email, each marked as required.
  const about = page.locator('section[aria-labelledby="you-h"]');
  await expect(about.locator('input').first()).toHaveAttribute('id', 'organizer');
  await expect(about.locator('input').nth(1)).toHaveAttribute('id', 'notify');
  for (const id of ['title', 'organizer', 'notify']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-required', 'true');
    await expect(page.locator(`label[for="${id}"] .req`)).toHaveText('Required');
  }
  await expect(page.locator('label[for="location"] .req')).toHaveCount(0);
  await page.click('#q-2w');
  await expect(page.locator('#summary')).toHaveText('Give your poll a name to create the poll (and 2 more things)');
  // Pressing Create marks each missing field, and goes to the first.
  await page.locator('#submit').click({ force: true });
  await expect(page.locator('#title')).toBeFocused();
  await expect(page.locator('#err')).toHaveText('Give your poll a name to create the poll (and 2 more things)');
  for (const [id, msg] of [
    ['title', 'Give your poll a name'],
    ['organizer', 'Add your name'],
    ['notify', 'Add your email'],
  ]) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(`#${id}-err`)).toHaveText(msg);
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-describedby', new RegExp(`^${id}-err`));
  }
  // Filling one in clears its message.
  await page.fill('#title', 'Cabin');
  await expect(page.locator('#title-err')).toHaveCount(0);
  await expect(page.locator('#title')).not.toHaveAttribute('aria-invalid');
  await expect(page.locator('#summary')).toHaveText('Add your name to create the poll (and 1 more thing)');
  await page.fill('#organizer', 'Sam');
  // The email is checked with the server's rule.
  await page.fill('#notify', 'sam@example');
  await expect(page.locator('#notify-err')).toHaveText('Check your email address');
  await expect(page.locator('#notify')).toHaveAttribute('aria-describedby', 'notify-err notify-hint');
  await page.fill('#notify', 'sam@example.com');
  await expect(page.locator('#notify-err')).toHaveCount(0);
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');
});

test('without email on the server, only the name is required', async ({ page }) => {
  await page.goto('/new/pick');
  await page.fill('#title', 'Dinner');
  await addOptions(page, 1);
  await expect(page.locator('#notify-field')).toBeHidden();
  await expect(page.locator('#summary')).toHaveText('Add your name to create the poll');
  await page.locator('#submit').click({ force: true });
  await expect(page.locator('#organizer')).toBeFocused();
  await expect(page.locator('#organizer-err')).toHaveText('Add your name');
  await page.fill('#organizer', 'Sam');
  await page.click('#submit');
  await openNewPoll(page);
  await expect(page.locator('#ev-title')).toHaveText('Dinner');
});

test('week view: a day at the top of the week opens it on its own', async ({ page }) => {
  await page.goto('/new/pick');
  await page.locator('#picker .tv-pick').waitFor();
  await page.click('#picker [data-view="week"]');
  const head = page.locator('#picker [data-open-day]').nth(3);
  const date = await head.getAttribute('data-open-day');
  await head.click();
  await expect(page.locator('#picker [data-view="day"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#picker .tg-col')).toHaveCount(1);
  await expect(page.locator('#picker .tg-col')).toHaveAttribute('data-date', date);
});

test('vote on a few dates starts at an hour, and Gym, Run, Bike and Golf are kinds of plan', async ({ page }) => {
  await page.goto('/new/pick');
  await expect(page.locator('[data-length="60"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#other-box summary')).toHaveText('Custom');
  for (const [name, length] of [
    ['Gym', '1 hour'],
    ['Run', '1 hour'],
    ['Bike', 'Custom · 2 hours, selected'],
    ['Golf', 'Custom · 4 hours, selected'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#title')).toHaveAttribute('placeholder', name);
    if (length === '1 hour') await expect(page.locator('[data-length="60"]')).toHaveAttribute('aria-pressed', 'true');
    else await expect(page.locator('#other-box summary')).toHaveText(length);
  }
});

test('usage stats: counted as people use Venn, and shown to whoever has the token', async ({ page }) => {
  // Browsers asking not to be tracked send nothing.
  const sent = [];
  page.on('request', (r) => r.url().endsWith('/api/usage') && sent.push(r.postDataJSON()));
  await page.goto('/new/free');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ name: 'view', props: { page: 'free' } });
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  await page.goto('/new/pick');
  await expect(page.locator('#title')).toBeVisible();
  await page.waitForTimeout(300);
  expect(sent.length).toBe(1);

  await page.goto('/stats');
  await page.fill('#token', 'wrong');
  await page.click('#login button[type=submit]');
  await expect(page.locator('#login [role=alert]')).toHaveText('Wrong stats token');
  await page.fill('#token', 'test-stats');
  await page.click('#login button[type=submit]');
  await expect(page.locator('h2', { hasText: 'What happens to polls' })).toBeVisible();
  await expect(page.locator('.tile').first()).toContainText('polls created');
  await expect(page.locator('section', { hasText: 'From visit to poll' })).toContainText('Ask when people are available');
  // The trend: a column a day, switched between metrics, folded into weeks over a year.
  await expect(page.locator('.cols .col')).toHaveCount(30);
  await expect(page.locator('h2', { hasText: 'Polls created by day of the week' })).toBeVisible();
  await page.click('[data-metric="views"]');
  await expect(page.locator('[data-metric="views"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('h2', { hasText: 'Poll views by day of the week' })).toBeVisible();
  await page.locator('.cols .col').last().hover();
  await expect(page.locator('.chart-tip')).toBeVisible();
  await page.click('[data-days="365"]');
  await expect(page.locator('.cols .col')).toHaveCount(53);
  await page.click('#refresh');
  await expect(page.locator('#updated')).toContainText('Updated at');
  // The token is remembered on this device, until it's forgotten.
  await page.reload();
  await expect(page.locator('.tile')).toHaveCount(5);
  await page.click('[data-days="7"]');
  await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('#logout');
  await expect(page.locator('#token')).toBeVisible();
});

test('when everyone gave their email, the organizer invites them all with the calendar, and can email them the date', async ({
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
        requireEmail: true,
      },
    })
  ).json();
  for (const [name, email] of [
    ['Ana', 'ana@example.com'],
    ['Jo', 'jo@example.com'],
  ])
    await request.post(`/api/events/${id}/participants`, { data: { name, email, availability: { [t0]: 2 } } });
  await request.post(`/api/events/${id}/finalize`, { data: { start: t0 }, headers: { 'x-admin-token': adminToken } });

  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('#cal-add-h')).toHaveText('Add it to your calendar, with everyone invited');
  await expect(page.locator('#cal-add-hint')).toContainText('the 2 people who answered as guests');
  const google = new URL(await page.getByRole('link', { name: 'Google Calendar' }).getAttribute('href'));
  expect(google.searchParams.get('add')).toBe('ana@example.com,jo@example.com');
  // The iCal file is made in the page, with everyone in it, so the emails never go in a link.
  const ical = page.getByRole('link', { name: 'iCal' });
  await expect(ical).toHaveAttribute('download', `${id}.ics`);
  const [download] = await Promise.all([page.waitForEvent('download'), ical.click()]);
  expect(download.suggestedFilename()).toBe(`${id}.ics`);
  const ics = readFileSync(await download.path(), 'utf8');
  expect(ics).toContain('ATTENDEE;CN="Ana";ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:ana@example.com');
  expect(ics).toContain('mailto:jo@example.com');
  // Email everyone: their email app, with everyone in BCC and the date and link filled in.
  const mail = await page.locator('#email-all').getAttribute('href');
  expect(mail.startsWith('mailto:?bcc=ana%40example.com,jo%40example.com&subject=')).toBe(true);
  expect(decodeURIComponent(mail.split('&body=')[1])).toContain(`/e/${id}`);

  // Guests see the ordinary buttons, and no one else's email.
  const guest = await page.context().browser().newPage();
  await guest.goto(page.url().split('#')[0]);
  await expect(guest.locator('#cal-add-h')).toHaveText('Add to your calendar');
  await expect(guest.locator('#email-all')).toHaveCount(0);
  expect(await guest.content()).not.toContain('ana@example.com');
  await guest.close();
});

test('a picked date can be saved as a picture, with who can make it unless the poll keeps that private', async ({
  page,
  request,
}) => {
  const t0 = Date.UTC(2030, 0, 8, 18);
  /** A picked poll that Ana and Jo can make. */
  async function picked(extra = {}) {
    const { id, adminToken } = await (
      await request.post('/api/events', {
        data: {
          title: 'Dinner at Finn’s',
          emoji: '🍝',
          timezone: 'UTC',
          mode: 'options',
          options: [{ start: t0, end: t0 + 7_200_000 }],
          ...extra,
        },
      })
    ).json();
    for (const name of ['Ana', 'Jo'])
      await request.post(`/api/events/${id}/participants`, { data: { name, availability: { [t0]: 2 } } });
    await request.post(`/api/events/${id}/finalize`, { data: { start: t0 }, headers: { 'x-admin-token': adminToken } });
    return { id, adminToken };
  }
  /** Press the button and read the downloaded picture from disk: its name, width and height. */
  async function save(button) {
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    const png = readFileSync(await download.path());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    return { name: download.suggestedFilename(), size: [png.readUInt32BE(16), png.readUInt32BE(20)] };
  }

  const { id } = await picked();
  await page.goto(`/e/${id}`);
  const button = page.locator('.final-more').getByRole('button', { name: /as a picture$/ });
  await expect(button).toBeVisible();
  expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await save(button)).toEqual({ name: 'dinner-at-finns-its-set.png', size: [1080, 1920] });
  await expect(page.locator('#toast')).toContainText('Picture saved');
  await expect(button).toHaveAttribute('data-card-faces', '2');
  // Keyboard works too.
  await button.focus();
  const [again] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(again.suggestedFilename()).toBe('dinner-at-finns-its-set.png');

  // Answers hidden from guests: the picture has no faces.
  const hidden = await picked({ hideResults: true });
  await page.goto(`/e/${hidden.id}`);
  expect((await save(button)).size).toEqual([1080, 1920]);
  await expect(button).toHaveAttribute('data-card-faces', '0');
  // Names hidden: not even the organizer's picture shows them.
  const anonymous = await picked({ hideNames: true });
  await page.goto(`/e/${anonymous.id}#admin=${anonymous.adminToken}`);
  await save(button);
  await expect(button).toHaveAttribute('data-card-faces', '0');
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
  // A one-hour option (the default length), available.
  await page.mouse.click((await col(1)).x + 10, grid.y + 10);
  // Then one that only works if needed.
  await page.click(`[data-pbrush="1"]`);
  await page.mouse.click((await col(3)).x + 10, grid.y + 10);
  await expect(page.locator('.tg-block.opt-maybe')).toHaveCount(1);
  await expect(page.locator('#options-list .chip.maybe')).toHaveCount(1);

  // Drag the first option's bottom edge down two rows: an hour becomes 2.
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

test('options in the poll are green when available and amber if needed', async ({ page }) => {
  await startPick(page, 'Dinner', [1140]);
  const chip = page.locator('#options-list .chip').first();
  const colors = () =>
    chip.evaluate((el) => {
      const css = getComputedStyle(document.documentElement);
      const probe = document.createElement('i');
      document.body.append(probe);
      const resolve = (v) => ((probe.style.color = css.getPropertyValue(v)), getComputedStyle(probe).color);
      const out = { bg: getComputedStyle(el).backgroundColor, yes: resolve('--yes'), maybe: resolve('--maybe') };
      probe.remove();
      return out;
    });
  let c = await colors();
  expect(c.bg).toBe(c.yes);
  await chip.locator('[data-flip]').click();
  await expect(page.locator('#options-list .chip').first()).toHaveClass(/maybe/);
  await expect(page.locator('#options-list [data-flip]').first()).toHaveAccessibleName(
    /if needed for you\. Switch to available$/,
  );
  c = await colors();
  expect(c.bg).toBe(c.maybe);
  await page.locator('#options-list [data-flip]').first().click();
  await expect(page.locator('#options-list .chip').first()).toHaveClass(/yes/);
});

test('picked times and days say Available or If needed on the calendar, and if-needed trips are amber throughout', async ({
  page,
}) => {
  await page.goto('/new/pick');
  await page.click('[data-occasion="0"]');
  const day = addDays(await todayIn(page), 3);
  await page.fill('#at-day', day);
  await page.selectOption('#at-time', '1140');
  await page.click('#at-add');
  await page.click('[data-pbrush="1"]');
  await page.selectOption('#at-time', '1020');
  await page.click('#at-add');
  const blocks = page.locator(`#picker .tg-col[data-date="${day}"] .tg-block`);
  await expect(blocks).toHaveCount(2);
  await expect(blocks.locator('small')).toHaveText(['If needed', 'Available']);

  // A trip that's only if needed is amber on every day, and each day says so.
  await page.click('[data-length="days"]');
  await showNextMonth(page);
  const first = await nextMonth(page);
  await page.locator(`#picker .cal-day[data-date="${first}"]`).click();
  for (const i of [0, 1, 2]) {
    const d = page.locator(`#picker .cal-day[data-date="${addDays(first, i)}"]`);
    await expect(d.locator('small')).toHaveText('If needed');
    if (i) await expect(d).toHaveClass(/trip-maybe/);
  }
});

test('guests are one tap from making their own poll: from the celebration, and once the date is set', async ({
  page,
  request,
}) => {
  const t0 = Date.UTC(2030, 0, 8, 18);
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: {
        title: 'Dinner',
        organizer: 'Sam',
        timezone: 'UTC',
        mode: 'options',
        options: [{ start: t0, end: t0 + 7_200_000 }],
      },
    })
  ).json();
  await page.goto(`/e/${id}`);
  await page.locator('#mine .row [data-vote="2"]').first().click();
  await page.fill('#name', 'Ana');
  await page.click('#save');
  await page.click('#sc-yes');
  // Finn celebrates, and offers the next step.
  await expect(page.locator('.party [role=status]')).toContainText("Finn is so glad you're in");
  const own = page.locator('.party-also');
  await expect(own).toHaveText('Planning something? Make your own poll');
  await own.click();
  await expect(page).toHaveURL(/\/new\?from=guest$/);
  await expect(page.locator('.party')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Vote on a few dates/ })).toBeVisible();

  // Once the date is picked: guests can make their own, the organizer can plan the next one.
  await request.post(`/api/events/${id}/finalize`, { data: { start: t0 }, headers: { 'x-admin-token': adminToken } });
  await page.goto(`/e/${id}`);
  await expect(page.locator('.final-more a[href="/new?from=set"]')).toHaveText('Make your own poll');
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator(`.final-more a[href="/new/pick?copy=${id}"]`)).toHaveText('Plan the next one');
});
