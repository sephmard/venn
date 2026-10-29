import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  addDays,
  addHours,
  addOptions,
  changeAnswer,
  nextMonth,
  pickDays,
  showDate,
  setLevel,
  showNextMonth,
  tapAt,
  tapDays,
  todayIn,
  submit,
  weekendsFrom,
  openTools,
} from './helpers.js';

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

/** Skip the "Your Venn is ready!" celebration and open the new poll. */
const openNewPoll = (page) => page.getByRole('button', { name: /^(View poll|Open .+ →)$/ }).click();

/** Whether "Mark many as if needed" says it's on, beside its name. */
const brushOn = (page) =>
  page.locator('#brush-box summary').evaluate((el) => getComputedStyle(el, '::after').content.includes('On'));

/** "Vote on a few dates": options that are a morning, an afternoon or an evening (under Custom). */
async function pickHalfDay(page) {
  await page.click('#other-box summary');
  await page.selectOption('#custom', 'half');
}

/** Start a "vote on a few dates" poll: 7 days, at the given start times. */
async function startPick(page, title, times = [1140]) {
  await page.goto('/new/pick');
  await page.fill('#title', title);
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 7, times);
}

/** The same day `n` months on, or that month's last day (as the calendar's « » go). */
const addMonths = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

test('vote on a few dates: collect votes, pick the final date', async ({ page, request }) => {
  await startPick(page, 'Dinner', [780, 1140]);
  await expect(page.locator('#summary')).toHaveText('14 options to vote on');

  await page.click('#submit');
  // A celebration, then the new poll.
  await expect(page.locator('.party [role=status]')).toHaveText(/Your Venn is ready!.*bringing people together/);
  // Sharing is the next step, so it's the main button.
  await expect(page.getByRole('button', { name: 'Share poll' })).toBeFocused();
  await expect(page.locator('#mine .row')).toHaveCount(14);
  await expect(page.locator('.party')).toHaveCount(0);
  await expect(page.locator('details.organizer')).not.toHaveAttribute('open', '');

  // The times the organizer offered are already their answer: yes to all of them.
  const row = (i) => page.locator('#mine .row').nth(i);
  await expect(page.locator('#mine .row[data-v="2"]')).toHaveCount(14);
  // The organizer is "Hosted by" in the header, not counted again as an answer.
  await expect(page.locator('#ev-meta')).toHaveText(/^S\s*Hosted by Sam\s*No answers yet$/);
  await changeAnswer(page); // the organizer's answer came with the poll
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
  // Everyone's answers: a row an option, each with its mix; unavailable shows in its own colour.
  await expect(page.locator('.ov-row')).toHaveCount(ev.slots.length);
  await expect(page.locator('.ov-bar .n').first()).toBeVisible();
  const best = page.locator('.best-hero');
  await expect(best).toContainText('Everyone can make it');
  // The host sees everyone by their full name.
  await expect(best.locator('.names')).toContainText('Sam, Lee');

  await best.locator('[data-pick]').click();
  // It asks first, with the date in big type: a stray tap picks nothing.
  await expect(page.locator('#pick-check')).toBeVisible();
  await expect(page.locator('#pick-check .pc-when')).not.toBeEmpty();
  await page.click('#pc-yes');
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

  await changeAnswer(page); // the organizer's answer came with the poll
  await page.click('#fill');
  await page.fill('#name', 'Sam');
  await submit(page);
  await page.locator('.best-hero [data-pick]').click();
  await page.click('#pc-yes');
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
  await pickDays(page, 14);
  await expect(page.locator('#summary')).toHaveText('14 days to choose from');
  // Days in a row starts off; switched on, it's 2.
  await expect(page.locator('#span')).toBeHidden();
  await page.getByRole('switch', { name: 'Days in a row' }).check();
  await expect(page.locator('#span')).toHaveValue('2');
  await expect(page.locator('#free-list')).toContainText('14 days');
  await expect(page.locator('#free-list')).not.toContainText('long enough');
  await page.click('#submit');

  await expect(page.locator('#mine .row')).toHaveCount(14);
  await expect(page.locator('#ev-details')).toContainText('Looking for 2 days in a row');
  await changeAnswer(page); // the organizer's answer came with the poll
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
  await tapDays(page, await weekendsFrom(page, 4)); // Fri – Sun, four times: 3 days in a row at most
  await page.check('#in-row');
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
  await expect(page.locator('#span')).toHaveValue('2');
});

test('ask when people are available: a tap picks days in a row, shown as one band and as a range', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Cabin weekend');
  await page.fill('#organizer', 'Sam');
  await page.check('#in-row');
  await page.fill('#span', '3');
  await expect(page.locator('#when-help')).toHaveText('Tap a day to pick 3 in a row from it.');
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
  // The preview lists the run as a range with its length (only a run that's too short says so).
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
  await expect(rows.first().locator('.od-len')).toHaveText('3 days');
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
  // Only what's really missing: three days, not also "three in a row".
  await expect(page.locator('#summary')).toHaveText('Pick at least 3 days, for 3 in a row');

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

test('ask when people are available: what the organizer picks is available or if needed for them', async ({ page, request }) => {
  await page.goto('/new/free');
  await page.fill('#title', 'Picnic');
  await page.fill('#organizer', 'Sam');
  await showNextMonth(page);
  // A Monday and Wednesday of next month, so the week calendar shows both.
  const next = await nextMonth(page);
  const first = addDays(next, (8 - new Date(`${next}T12:00:00Z`).getUTCDay()) % 7);
  const day = (n) => page.locator(`.cal-day[data-date="${addDays(first, n)}"]`);
  // New days are available; a second tap makes one if needed.
  await day(0).click();
  await day(0).click();
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
  await setLevel(page, 'parts');
  await expect(page.locator('.pg-cell.part.on.maybe')).toHaveCount(3);
  await expect(page.locator('.pg-cell.part.on:not(.maybe)')).toHaveCount(3); // the week, on phones too
  // In the list, each whole day is one chip.
  await expect(page.locator('#free-list .chip.maybe')).toHaveText(['All day If needed×']);
  await setLevel(page, 'hours');
  await expect(page.locator('#free-list .od-row').first().locator('.chip.maybe')).toHaveCount(1);
  await expect(page.locator('#free-list .chip:not(.maybe)')).toHaveCount(1);
  await setLevel(page, 'days');
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

  // Times too: two of them, if needed.
  await page.goto('/new/free');
  await page.fill('#title', 'Coffee');
  await setLevel(page, 'hours');
  // Many at once, if needed: the switch folded away under the calendar.
  await page.click('#brush-box summary');
  await page.check('#brush');
  await addHours(page, 2, [600]);
  await expect(page.locator('#free-list .chip.maybe').first()).toBeVisible();
  await expect(page.locator('#free-list .chip:not(.maybe)')).toHaveCount(0);
  await page.click('#submit');
  const hours = await answer();
  expect(hours.length).toBeGreaterThan(0);
  expect(new Set(hours)).toEqual(new Set([1]));
});

test('month calendars open on next month near the end of this one', async ({ page }) => {
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
});

test('ask when people are free: paint hours and see the best time', async ({ page, isMobile }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Book club');
  await setLevel(page, 'hours');
  await page.click('[data-flength="60"]');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'true');
  // Drawn on the calendar: three hours, 9 to 12, on two days.
  await addHours(page, 2, [540, 600, 660]);
  await expect(page.locator('#free-list')).toContainText('9 AM – 12 PM');
  await page.click('#submit');
  await expect(page.locator('#panel-mine h2')).toHaveText('When are you available?');
  await changeAnswer(page); // the organizer's answer came with the poll
  // Phones start with parts of the day, the quickest way on a small screen; exact times are one tap away.
  // With a mouse, it's exact times.
  await expect(page.locator(`[data-hview="${isMobile ? 'quick' : 'exact'}"]`)).toHaveAttribute('aria-checked', 'true');
  if (isMobile) await expect(page.locator('#quick-hours .part-vote').first()).toBeVisible();
  await page.click('[data-hview="exact"]');
  await expect(page.locator('#mine .cell[data-slot]').first()).toBeVisible();
  await expect(page.locator('#mine .cell[data-slot]:not(.yes)')).toHaveCount(0); // the organizer is free when they offered
  await page.click('#none');
  // Phones show one day at a time, and the page still fits the screen.
  if (isMobile) await expect(page.locator('#hour-days .tv-chip')).toHaveCount(2);
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
  await changeAnswer(page); // the organizer's answer came with the poll
  await page.click('#fill');
  await page.fill('#name', 'Sam');
  await submit(page);
  await expect(page.locator('.ov-list')).toBeVisible();
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
  expect(t.description).toMatch(
    /^Priya wants to find a time for Dinner at &lt;Finn’s&gt;\. \w{3}, \w{3} \d+\. Tap when you&#39;re free\. No sign-up\.$/,
  );
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
  await openTools(page);
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
  // The poll already has a name, so Create only waits for an option, and says so.
  await expect(page.locator('#title')).toHaveValue('Get-together');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#summary')).toHaveText('Add at least one option to create the poll');
  await expect(page.locator('#options-list')).toContainText('Nothing yet');
  // It can still be reached and pressed: it says what's missing.
  await page.locator('#submit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#err')).toHaveText('Add at least one option to create the poll');
  await expect(page).toHaveURL(/\/new\/pick$/);
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

test('switching lengths keeps the days picked, and organizers are asked before one × removes several', async ({ page }) => {
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
  // Switching between times and whole days needs no asking: the days stay, as whole days, and
  // come back at their time. (Some in-app browsers block confirm() and would stop the switch.)
  let asked;
  await page.click('[data-length="allday"]');
  await expect(page.locator('[data-length="allday"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#picker .cal-day[aria-pressed="true"]')).toHaveCount(2);
  await expect(page.locator('#options-list .chip')).toHaveText(['All day×', 'All day×']);
  await page.click('[data-length="days"]');
  await expect(page.locator('#options-list .chip')).toHaveCount(2);
  await page.click('[data-length="60"]');
  await expect(page.locator('#options-list .chip')).toHaveText([/^7\D+8 PM/, /^7\D+8 PM/]);

  // On "ask when people are free", one × can stand for two weeks of whole days.
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await pickDays(page, 14);
  await setLevel(page, 'parts');
  await expect(page.locator('[data-level="parts"]')).toHaveAttribute('aria-checked', 'true'); // the painter loads first
  const rows = page.locator('#free-list .od-row');
  const before = await page.locator('#free-list .chip').count();
  const rm = rows.first().locator('[data-rm-window]').last();
  asked = answer(false);
  await rm.click();
  expect(await asked).toMatch(/^Remove these \d+ days\?$/);
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
  await pickDays(page, 3);
  await expect(page.locator('#notify')).toBeVisible();
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#summary')).toHaveText('Add your email to create the poll');
  await page.fill('#notify', 'sam@example');
  await expect(page.locator('#summary')).toHaveText('Check your email address');
  await page.fill('#notify', 'sam@example.com');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');
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
  await changeAnswer(page);
  await page.locator('#mine .row').first().locator('[data-vote="2"]').tap();
  // Answering shows Save in reach, and how far along the answer is: the organizer's own answer has them all.
  await expect(page.locator('#save-state')).toHaveText('Ready to submit');
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

  // ‹ › go a week at a time, and the week runs Monday to Sunday.
  const next = page.getByRole('button', { name: 'Next week' });
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeDisabled();
  await next.click();
  await page.click('[data-view="week"]');
  const days = page.locator('#picker .tg-col');
  await expect(days).toHaveCount(7);
  const first = await days.first().getAttribute('data-date');
  expect(new Date(`${first}T12:00:00Z`).getUTCDay()).toBe(1);
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
  // No × in a narrow week column, too small to tap well: it's on the day view.
  await expect(page.locator('.tg-x')).toBeHidden();
  await page.click('[data-view="day"]');
  await showDate(page, addDays(first, 15));
  // The × has a 44px hit area: a near miss removes the option instead of switching it to if needed.
  const x = await page.locator('.tg-x').boundingBox();
  await page.touchscreen.tap(x.x - 7, x.y + x.height + 7);
  await expect(page.locator('.tg-block')).toHaveCount(0);
});

test('phone: the calendars leave room to scroll the page, with no sentence over them', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone-only behaviour');
  const half = page.viewportSize().height / 2;
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');
  await page.locator('#picker .tv-pick').waitFor(); // drawn again once day-nav.js is in
  expect((await page.locator('.tg-scroll').boundingBox()).height).toBeLessThanOrEqual(half);
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await setLevel(page, 'hours');
  const hours = page.locator('#when .tg-scroll');
  expect((await hours.boundingBox()).height).toBeLessThanOrEqual(half);
  // No sentence over the calendar: the tap key says how.
  await expect(page.locator('#when-help')).toBeHidden();
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

test('the day strip scrolls through the months ahead; › goes a week and » a month', async ({ page, isMobile }) => {
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
  // » goes on a month and « back; ‹ › still go a week. The day shown stays in view in the strip.
  await page.getByRole('button', { name: 'Forward a month' }).click();
  const month = addMonths(later, 1);
  await expect(shown).toHaveAttribute('data-date', month);
  const inView = async () => {
    const [c, s] = [await picked.boundingBox(), await strip.boundingBox()];
    return c.x >= s.x - 1 && c.x + c.width <= s.x + s.width + 1;
  };
  await expect.poll(inView).toBe(true);
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(picked).toHaveAttribute('data-day', addDays(month, 7));
  await expect.poll(inView).toBe(true);
  await page.getByRole('button', { name: 'Back a month' }).click();
  const back = addMonths(addDays(month, 7), -1);
  await expect(picked).toHaveAttribute('data-day', back);
  // An option shows on its day's chip.
  await tapAt(page, back, 1140);
  await expect(picked.locator('i')).toHaveText('1');
  // Not before today: « goes back to today, then it's off.
  await page.getByRole('button', { name: 'Back a month' }).click();
  await expect(picked).toHaveAttribute('data-day', today);
  await expect(page.getByRole('button', { name: 'Back a month' })).toBeDisabled();
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
  await page.getByRole('button', { name: 'Forward a month' }).click();
  const shown = await page.locator('#picker .tg-col').first().getAttribute('data-date');
  await expect(day).toHaveValue(shown);
  // A day gone by isn't added.
  await day.fill(addDays(today, -2));
  await page.click('#at-add');
  await expect(page.locator('#options-list .chip')).toHaveCount(1);
  await expect(day).toBeFocused();
});

test('landing page: the logo, Create a Venn and the menu (GitHub is in it), and one way in', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'GitHub' })).toBeHidden(); // not in the bar itself
  await page.locator('.menu summary').click();
  await expect(page.locator('.menu-panel').getByRole('link', { name: 'Privacy' })).toBeVisible();
  await expect(page.locator('.menu-panel').getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/sephmard/venn',
  );
  await page.locator('.menu summary').click();
  await expect(page.locator('h1')).toHaveText(/Find the day that works/);
  // "Create a Venn" stays in the sticky bar however far down people scroll, without sideways scrolling.
  const create = page.locator('.topbar').getByRole('link', { name: 'Create a Venn' });
  await expect(create).toHaveAttribute('href', '/new');
  await page.locator('footer').scrollIntoViewIfNeeded();
  await expect(create).toBeInViewport();
  expect((await create.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  // The hero's one button opens the create page; no plans or templates to choose from first.
  await expect(page.locator('.hero a[href^="/new?"]')).toHaveCount(0);
  await page.locator('.hero').getByRole('link', { name: 'Create a Venn' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.locator('#create h1')).toHaveText('Create a Venn');
  await expect(page.getByRole('button', { name: 'Create Venn' })).toBeVisible();
});

test('the poll created celebration shows the dog; Share poll copies the link and opens the poll', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');
  await page.getByRole('button', { name: 'Book club' }).click();
  await addOptions(page, 7, [1140]);
  await page.click('#submit');
  await expect(page.locator('.party [role=status]')).toContainText('Your Venn is ready!');
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
  await page.getByRole('switch', { name: 'Ask guests for their email' }).check();
  await page.getByRole('switch', { name: 'Hide names from guests' }).check();
  await page.click('#submit');
  await page.getByRole('button', { name: 'View poll' }).click();
  await expect(page.locator('#mine .row')).toHaveCount(7);
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
  await page.getByRole('switch', { name: 'Hide answers from guests' }).check();
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
  await openTools(page);
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('h1')).toHaveText('Edit your poll');
  await expect(page.locator('#title')).toHaveValue('Dinner');
  await expect(page.locator('#organizer')).toHaveValue('Sam');
  await expect(page.locator('#options-list [data-remove]')).toHaveCount(7);
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
  await expect(page.locator('#options-list [data-remove]')).toHaveCount(6);
  await page.click('#submit');
  await openNewPoll(page);
  await expect(page).not.toHaveURL(url);
  await expect(page.locator('#ev-meta')).toContainText('No answers yet'); // a new poll, with only the organizer's
});

test('hours: a whole day reads "All day", and days in a row stay whole days', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2030, 0, 9, 12)); // a Wednesday
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  // Times from 9 AM to 10 PM or later read as the whole day: seven 2-hour taps, back to back.
  await setLevel(page, 'hours');
  await page.click('[data-flength="120"]');
  for (let m = 540; m < 1320; m += 120) await tapAt(page, '2030-01-09', m, '#when');
  await expect(page.locator('#free-list .chip')).toHaveText(['All day×']);
  await expect(page.locator('#when .tg-block').first()).toContainText('All day');

  // Days in a row are whole days: dates and times wait until it's off again.
  await setLevel(page, 'days');
  await page.check('#in-row');
  await expect(page.locator('[data-level="parts"]')).toBeDisabled();
  await expect(page.locator('[data-level="hours"]')).toBeDisabled();
  await page.uncheck('#in-row');
  await expect(page.locator('[data-level="hours"]')).toBeEnabled();
});

test('"when are you free" polls come back to edit at their level: hours, or parts of the day', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Book club');
  await setLevel(page, 'hours');
  await addHours(page, 2, [540, 600, 660]); // 9 to 12, two days
  await page.click('#submit');
  await openNewPoll(page);
  await openTools(page);
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('#title')).toHaveValue('Book club');
  await expect(page.locator('[data-level="hours"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#free-list')).toContainText('9 AM – 12 PM');
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');

  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Coffee');
  const [first] = await pickDays(page, 14);
  await setLevel(page, 'parts');
  await expect(page.locator('#summary')).toHaveText('42 times to choose from');
  await page.locator(`#when [data-fill-day="${first}"]`).click(); // the first day's name: none of it
  await expect(page.locator('#summary')).toHaveText('39 times to choose from');
  await page.click('#submit');
  await openNewPoll(page);
  await openTools(page);
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('[data-level="parts"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#summary')).toHaveText('39 times to choose from');
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

test('"Email me a copy" starts ticked and then needs an email; unticked, the email is optional', async ({ page, request }) => {
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), email: true } });
  });
  const t0 = Date.UTC(2030, 0, 8, 18);
  const { id } = await (
    await request.post('/api/events', {
      data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options: [{ start: t0, end: t0 + 7_200_000 }] },
    })
  ).json();
  await page.goto(`/e/${id}`);
  await expect(page.locator('#copy-me')).toBeChecked();
  await expect(page.locator('#copy-to')).toHaveAttribute('aria-required', 'true');
  await expect(page.locator('label[for="copy-to"]')).toContainText('(for your copy)');
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await page.fill('#name', 'Ana');
  await page.fill('#copy-to', '');
  await submit(page);
  await expect(page.locator('#save-err')).toHaveText('Add your email for your copy, or untick "Email me a copy".');
  await expect(page.locator('#copy-to')).toBeFocused();
  await expect(page.locator('#copy-to')).toHaveAttribute('aria-invalid', 'true');
  await page.uncheck('#copy-me');
  await expect(page.locator('#copy-to')).toHaveAttribute('aria-required', 'false');
  await expect(page.locator('label[for="copy-to"]')).toContainText('(optional)');
  await submit(page);
  await expect(page.locator('#save-state')).toHaveText('Submitted');
});

test("the organizer link on another device finds the organizer's own answer", async ({ page, browser }) => {
  await startPick(page, 'Dinner', [1140]);
  await page.click('#submit');
  await openNewPoll(page);
  // The organizer answers on this device.
  await changeAnswer(page);
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await submit(page);
  const url = page.url();
  const token = await page.evaluate((id) => JSON.parse(localStorage.getItem(`venn:${id}`)).adminToken, url.split('/e/')[1]);
  const other = await (await browser.newContext()).newPage();
  await other.goto(`${url}#admin=${token}`);
  await expect(other.locator('#edit-link')).toContainText('Answering as Sam.');
  await expect(other.locator('#edit-link')).not.toContainText('personal link');
  await changeAnswer(other);
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
  // Answers are hidden from guests, so the celebration goes back to the poll.
  await page.getByRole('button', { name: 'Back to the poll' }).click();
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
  await changeAnswer(page);
  await page.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await page.fill('#name', 'Sam');
  await submit(page);
  await expect(page.locator('#save-state')).toHaveText('Submitted');

  await page.click('#ai-summary-btn');
  await expect(page.locator('.ai-card')).toContainText('Most people can make the first option.');
  await page.locator('.ai-card [data-pick]').click();
  await page.click('#pc-yes');
  await expect(page.locator('.banner-final')).toBeVisible();

  await openTools(page);
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
  // In this device's own time zone: its afternoon label only where it's the organizer's afternoon too.
  const local = await page.evaluate((t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric' }), day(8, 12));
  await expect(page.locator('.best-hero')).toContainText(`Jan 8, ${local.split(/\s/)[0]}:00`);
  // Everyone's answers are colour-coded: available, if needed and unavailable, with a key.
  const rows = page.locator('#overlap .ov-row');
  await expect(rows.nth(0).locator('.ov-bar')).toHaveCount(0); // everyone's free: ✓ Everyone says it
  await expect(rows.nth(1).locator('.ov-bar i')).toHaveClass(['m']);
  await expect(rows.nth(2).locator('.ov-bar i')).toHaveClass(['n']);
  await expect(rows.nth(2)).toHaveAccessibleName(/1 unavailable/);
  await expect(rows.nth(0)).toContainText('✓ Everyone');
  await expect(page.locator('#panel-group .legend', { hasText: 'Unavailable' })).toBeVisible();
  // Just the three answers in the key: "✓ Everyone" on a row says itself.
  await expect(page.locator('.ov-legend')).toHaveText(/^\s*Available\s*If needed\s*Unavailable\s*$/);
  // A tap shows who.
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.ov-who')).toContainText('Sam');
  // Who answered what, a line per answer, marked as in the key: here, Sam is available.
  const said = page.locator('.ov-item.open .ov-group');
  await expect(said).toHaveCount(1);
  await expect(said.locator('.ov-group-h')).toHaveText('Available');
  await expect(said.locator('.chip.yes')).toContainText('Sam');
  // And on a time Sam can't make: under Unavailable.
  await rows.nth(2).click();
  await expect(said.locator('.ov-group-h')).toHaveText('Unavailable');
  await expect(said.locator('.chip.no')).toContainText('Sam');
});

test('guests can see the options on a calendar and answer there', async ({ page, request }) => {
  const H = 3_600_000;
  const t0 = Date.UTC(2030, 0, 8, 17); // 5pm UTC, two overlapping options and one the next day
  const options = [
    { start: t0, end: t0 + 2 * H },
    { start: t0 + H, end: t0 + 3 * H },
    { start: t0 + 24 * H, end: t0 + 26 * H },
    // Guests get the calendar once there are more than six options; shorter polls are just their list.
    ...[2, 3, 4, 5].map((d) => ({ start: t0 + d * 24 * H, end: t0 + (d * 24 + 2) * H })),
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
    // A painted answer is a whole answer: Submit sends it straight away, with the same celebration organizers get.
    await expect(page.locator('#save-state')).toHaveText('Ready to submit');
    await page.click('#save');
    const check = page.locator('#submit-check');
    await expect(page.locator('.party [role=status]')).toContainText(/Answer submitted!.*Sam can see it now/);
    await expect(check).toBeHidden();
    await expect(page.locator('.party-hero img')).toHaveCount(1);
    await expect(page.locator('.party')).toHaveCount(0, { timeout: 10_000 }); // it goes by itself
    await expect(page.locator('#save')).toHaveText('Submit');
    await expect(page.locator('#save-state')).toHaveText('Submitted');
    // Changing it later says so. (Phones show the group after the first answer; go back to yours.)
    if (await page.locator('#tab-mine').isVisible()) await page.click('#tab-mine');
    await page.click('#save');
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
  await setLevel(page, 'hours');
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

test('ask when people are free: zoom from whole days to parts of the day to hours', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Picnic');
  // A Monday and Tuesday of next month: one week on the calendar.
  const next = await nextMonth(page);
  const monday = addDays(next, (8 - new Date(`${next}T12:00:00Z`).getUTCDay()) % 7);
  await tapDays(page, [monday, addDays(monday, 1)]);
  await expect(page.locator('#summary')).toHaveText('2 days to choose from');

  // Parts of the day keeps the days, with mornings, afternoons and evenings on a calendar.
  await setLevel(page, 'parts');
  await expect(page.locator('#summary')).toHaveText('6 times to choose from');
  await expect(page.locator('.pg-cell.part.on')).toHaveCount(6); // the week, on phones too
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
  await expect(days.nth(1).locator('.chip')).toHaveText(['All day×']);

  // Hours starts from those parts, and zooming out keeps the days.
  await setLevel(page, 'hours');
  await expect(days).toHaveCount(2);
  await expect(days.nth(1)).toContainText('All day');
  await setLevel(page, 'days');
  await expect(page.locator('#summary')).toHaveText('2 days to choose from');

  // Back in, each day keeps its parts.
  await setLevel(page, 'parts');
  await expect(page.locator('#summary')).toHaveText('5 times to choose from');
  await page.click('#submit');
  await expect(page.locator('.part-vote')).toHaveCount(5);
});

test('on a phone, a new poll leads with sharing: one share button, the group, and the answer as one line', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await startPick(page, 'Book club');
  await page.click('#submit');
  await openNewPoll(page);
  await expect(page.locator('#ev-title')).toHaveText('Book club');
  await expect(page.locator('.finn[data-finn="waiting"]')).toBeVisible();

  // One way to share on the page: the big button at the top. Finn's note doesn't add another.
  const share = page.locator('button:visible', { hasText: /^(Share the poll|Copy invite link)$/ });
  await expect(share).toHaveCount(1);
  await expect(share).toHaveId('copy');
  await expect(share).toHaveClass(/btn-primary/);
  await expect(page.locator('.finn [data-share]')).toHaveCount(0);

  // The organizer's tools wait closed, one line; open, the buttons and what the private link is for.
  const tools = page.locator('details.organizer');
  await expect(tools).not.toHaveAttribute('open', '');
  await expect(tools.locator('summary')).toHaveText(/^Your Venn is ready\. Share the link with your group\.$/);
  await tools.locator('summary').click();
  await expect(tools.locator('#notify-open')).not.toHaveClass(/btn-primary/);
  await expect(tools.getByRole('button', { name: 'Copy private organizer link' })).toHaveAccessibleDescription(
    /another device\. Don't share it/,
  );

  // It opens on the group, where Pick and the results are.
  await expect(page.locator('#tab-group')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-group')).toBeVisible();
  await expect(page.locator('#best .only-you')).toHaveText('Only your answer so far.');

  // Their own answer, given with the poll, is one line until they change it.
  await page.click('#tab-mine');
  await expect(page.locator('#org-answer')).toHaveText(/^Your answer: 7 yes\s*·\s*Change your answer$/);
  for (const hidden of ['#mine', '#name', '#save', '#leave']) await expect(page.locator(hidden)).toBeHidden();
  await page.getByRole('button', { name: 'Change your answer' }).click();
  await expect(page.locator('#org-answer')).toBeHidden();
  await expect(page.locator('#panel-mine .panel-title')).toBeFocused();
  for (const shown of ['#mine', '#name', '#save', '#leave']) await expect(page.locator(shown)).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('Sam');

  // A changed answer goes back to one line.
  await page.click('#none');
  await page.locator('#mine .row').nth(0).locator('[data-vote="2"]').click();
  await page.locator('#mine .row').nth(1).locator('[data-vote="1"]').click();
  await submit(page);
  await page.click('#tab-mine');
  await expect(page.locator('#org-answer')).toHaveText(/^Your answer: 1 yes, 1 if needed\s*·\s*Change your answer$/);

  // Coming back later, the tools are folded away and it's still the group first.
  await page.reload();
  await expect(page.locator('#ev-title')).toHaveText('Book club');
  await expect(page.locator('details.organizer')).not.toHaveAttribute('open', '');
  await expect(page.locator('details.organizer summary')).toContainText("You're the organizer.");
  await expect(page.locator('#tab-group')).toHaveAttribute('aria-selected', 'true');

  // A guest still starts on their own answer, with the whole form.
  const guest = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const g = await guest.newPage();
  await g.goto(page.url());
  await expect(g.locator('#tab-mine')).toHaveAttribute('aria-selected', 'true');
  await expect(g.locator('#save')).toBeVisible();
  await expect(g.locator('#org-answer')).toHaveCount(0);
  await expect(g.locator('details.organizer')).toHaveCount(0);
  // And again when they come back after answering: their answer first, the group a tap away.
  await g.locator('#mine .row').first().locator('[data-vote="2"]').click();
  await g.fill('#name', 'Ana');
  await submit(g);
  await g.reload();
  await expect(g.locator('#ev-title')).toHaveText('Book club');
  await expect(g.locator('#tab-mine')).toHaveAttribute('aria-selected', 'true');
  await guest.close();
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
  // For the organizer, the calendars are behind "Add to calendar", next to "Send everyone the date".
  await page.locator('.final-cal summary').click();
  const group = page.getByRole('group', { name: 'Add to your calendar' });
  // One quiet row of three, with short names; screen readers hear the full ones.
  const links = group.getByRole('link');
  await expect(links).toHaveCount(3);
  for (const [i, name] of ['Google', 'Outlook', 'Apple'].entries())
    await expect(links.nth(i).locator('> span')).toHaveText(new RegExp(`^${name}`));
  for (const [i, name] of ['Google Calendar', 'Outlook', 'Apple Calendar (iCal)'].entries())
    await expect(links.nth(i)).toHaveAccessibleName(name);
  // Once the date is picked, the banner says it: the ranking of times steps aside.
  await expect(page.locator('#best')).toBeHidden();
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
  const [download] = await Promise.all([page.waitForEvent('download'), group.getByRole('link', { name: /iCal/ }).click()]);
  expect(download.suggestedFilename()).toBe(`${id}.ics`);
  const ics = await (await request.get(`/api/events/${id}/event.ics`)).text();
  expect(ics).toContain('SUMMARY:Dinner');
  expect(ics).toContain('DTSTART:20300108T180000Z');

  // Telling everyone first; Change right under the date, and clearing it under More.
  const banner = page.locator('.banner-final');
  await expect(banner.locator('.final-tell [data-share]')).toBeVisible();
  await expect(page.locator('.poll-share')).toBeHidden(); // the banner says how to share now
  await expect(banner.getByRole('button', { name: 'Change the date' })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Clear the date' })).toBeHidden();
  await banner.locator('.final-extras summary').click();
  await banner.getByRole('button', { name: 'Clear the date' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Add to your calendar' })).toHaveCount(0);
});

test('a date picked while the poll is open shows "Add to your calendar" straight away', async ({ page, request }) => {
  await organizerPoll(page, request, { answered: true });
  await page.locator('.best-hero [data-pick]').click();
  await page.click('#pc-yes');
  await page.locator('.final-cal summary').click();
  await expect(page.getByRole('group', { name: 'Add to your calendar' }).getByRole('link')).toHaveCount(3);
});

test('the share sheet sends a short nudge with the link; a copy is just the link', async ({ page, request, isMobile }) => {
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
  // With the date picked, the header's Share steps aside for the banner's "Send everyone the date".
  await expect(page.locator('#copy')).toBeHidden();
  await page.locator('.banner-final [data-share]').click();
  const shared = await page.evaluate(() => window.shared);
  expect(shared).toHaveLength(1);
  // Phones get the share sheet with a line about the poll; a copy is the bare link, which chat apps unfurl.
  const text = "It's set: Dinner! Add it to your calendar:";
  for (const s of shared) expect(s).toEqual(isMobile ? { title: 'Dinner', text, url } : { copied: url });

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
  await expect(page.locator('#panel-mine .legend')).toHaveText(/Tap: available\s+Tap again: if needed\s+Tap again: unavailable/);
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
  // The soft unavailable colour of everyone's answers, never an alarming red.
  const red = await no.first().evaluate((el) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--no-cell)';
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
  await openTools(page);
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('#more-box')).toHaveAttribute('open', '');
  await expect(page.locator('#location')).toHaveValue('Rosa’s Trattoria');
});

test('how long: 1 to 4 hours, all day, several days, and half days or any other length under Custom', async ({ page }) => {
  await page.goto('/new/pick');
  const chips = page.locator('[data-length]');
  await expect(chips).toHaveText(['1 hour', '2 hours', '3 hours', '4 hours', 'All day', 'Several days']);
  // Two rows on a phone, without a sideways scroll.
  const rows = new Set(await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top))));
  expect(rows.size).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const other = page.locator('#other-box');
  // Dinner is two hours, a chip of its own: Custom isn't chosen.
  await page.click('[data-occasion="0"]');
  await expect(page.locator('[data-length="120"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-length][aria-pressed="true"]')).toHaveCount(1);
  await expect(other.locator('summary')).toHaveText('Custom');
  await expect(other).not.toHaveClass(/\bon\b/);
  // Coffee is an hour.
  await page.click('[data-occasion="2"]');
  await expect(page.locator('[data-length="60"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(other).not.toHaveAttribute('open', '');
  await expect(other.locator('summary')).toHaveText('Custom');
  // Opening Custom uses the length it shows (30 minutes), and it looks like a chosen chip.
  await other.locator('summary').click();
  await expect(page.locator('[data-length][aria-pressed="true"]')).toHaveCount(0);
  await expect(other.locator('summary')).toHaveText('Custom · 30 min, selected');
  await expect(other).toHaveClass(/\bon\b/);
  const bg = await other.locator('summary').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe(await page.locator('[data-occasion="2"]').evaluate((el) => getComputedStyle(el).backgroundColor));
  // Choosing another one changes it.
  await page.selectOption('#custom', '90');
  await expect(other.locator('summary')).toHaveText('Custom · 1 hr 30 min, selected');
  await expect(page.locator('#custom option:checked')).toHaveText('1 hr 30 min');
  await addOptions(page, 1, [1080]);
  await expect(page.locator('#options-list .chip')).toContainText(/6(:00)? – 7:30 PM/);
  // A pill again: Custom folds away.
  await page.click('[data-length="180"]');
  await expect(other).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#options-list .chip')).toContainText('6 – 9 PM');
});

test('a second tap makes an option "if needed" on every create calendar, and the page says how', async ({ page }) => {
  // Whole days on "vote on a few dates": tap, tap again, then a third tap takes it away.
  await page.goto('/new/pick');
  await page.click('[data-length="allday"]');
  await expect(page.locator('.tap-key')).toHaveText(/Tap: available\s*Tap again: if needed/);
  await showNextMonth(page);
  const day = page.locator(`.cal-day[data-date="${addDays(await nextMonth(page), 2)}"]`);
  await day.click();
  // The key above the calendar says it: no tip pops up over the calendar.
  await expect(page.locator('#toast')).not.toContainText('Tip');
  const chip = page.locator('#options-list .chip');
  await expect(chip).toHaveCount(1);
  await expect(chip.locator('.chip-tag')).toHaveCount(0);
  await day.click();
  await expect(chip.locator('.chip-tag')).toHaveText('If needed');
  await expect(day).toHaveClass(/day-maybe/);
  await day.click();
  await expect(chip).toHaveCount(0);

  // Mornings, afternoons and evenings (a half day, under Custom) go round the same way.
  await pickHalfDay(page);
  await expect(page.locator('.tap-key')).toBeVisible();
  await page.click('#picker [data-pstep="1"]'); // next week
  const morning = page.locator('#picker .pg-cell[data-c="0"][data-m="540"]');
  await morning.click();
  await expect(chip).toHaveCount(1);
  await expect(chip.locator('.chip-tag')).toHaveCount(0);
  await morning.click();
  await expect(chip.locator('.chip-tag')).toHaveText('If needed');
  await expect(morning).toHaveClass(/maybe/);
  await morning.click();
  await expect(chip).toHaveCount(0);

  // The other create page shows the same key.
  await page.goto('/new/free');
  await expect(page.locator('.tap-key')).toHaveText(/Tap: available\s*Tap again: if needed/);
});

test('half day: pick mornings, afternoons and evenings on days, and edit them again', async ({ page, request }) => {
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Book club');
  await pickHalfDay(page);
  await expect(page.locator('#other-box summary')).toHaveText('Custom · Half day, selected');
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
  await openTools(page);
  await page.getByRole('link', { name: 'Edit poll' }).click();
  await expect(page.locator('#other-box summary')).toHaveText('Custom · Half day, selected');
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
  for (const id of ['organizer', 'notify']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-required', 'true');
    await expect(page.locator(`label[for="${id}"] .req`)).toHaveText('Required');
  }
  // The poll's name isn't: it starts with one.
  await expect(page.locator('#title')).not.toHaveAttribute('aria-required');
  for (const id of ['title', 'location']) await expect(page.locator(`label[for="${id}"] .req`)).toHaveCount(0);
  await pickDays(page, 3);
  await expect(page.locator('#summary')).toHaveText('Needed: your name · email');
  // Pressing Create marks each missing field, and goes to the first.
  await page.locator('#submit').click({ force: true });
  await expect(page.locator('#organizer')).toBeFocused();
  await expect(page.locator('#err')).toHaveText('Add your name to create the poll');
  for (const [id, msg] of [
    ['organizer', 'Add your name'],
    ['notify', 'Add your email'],
  ]) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(`#${id}-err`)).toHaveText(msg);
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-describedby', new RegExp(`^${id}-err`));
  }
  // Filling one in clears its message.
  await page.fill('#organizer', 'Sam');
  await expect(page.locator('#organizer-err')).toHaveCount(0);
  await expect(page.locator('#organizer')).not.toHaveAttribute('aria-invalid');
  await expect(page.locator('#summary')).toHaveText('Add your email to create the poll');
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

test('the bar under the form names what’s still needed, and each one goes to its field', async ({ page }) => {
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), email: true } });
  });
  await page.goto('/new/pick');
  const bar = page.locator('#summary');
  await expect(bar).toHaveAttribute('aria-live', 'polite');
  await expect(bar).toHaveText('Needed: options · your name · email');
  // Short enough for two lines on a phone (measured in the page's own font, once it has loaded).
  await page.evaluate(() => document.fonts.ready);
  const lines = await bar.evaluate((el) => el.offsetHeight / parseFloat(getComputedStyle(el).lineHeight));
  expect(lines).toBeLessThanOrEqual(2.2);
  for (const [name, field] of [
    ['your name', '#organizer'],
    ['email', '#notify'],
    ['options', '#at-day'],
  ]) {
    await bar.getByRole('button', { name, exact: true }).click();
    await expect(page.locator(field)).toBeFocused();
    await expect(page.locator(field)).toBeInViewport();
  }
  // Filled in, each leaves the list; the last thing left is said in full, and still goes there.
  await page.fill('#organizer', 'Sam');
  await expect(bar).toHaveText('Needed: options · email');
  await page.fill('#notify', 'sam@example.com');
  await expect(bar).toHaveText('Add at least one option to create the poll');
  await page.locator('#title').focus();
  await bar.getByRole('button', { name: 'Add at least one option to create the poll' }).click();
  await expect(page.locator('#at-day')).toBeFocused();
  await addOptions(page, 1);
  await expect(bar).toHaveText('1 option to vote on');
  await expect(bar.getByRole('button')).toHaveCount(0);
});

test('a template names the poll, and the name is never what’s missing', async ({ page }) => {
  await page.goto('/new/pick');
  await page.fill('#organizer', 'Sam');
  await expect(page.locator('#summary')).toHaveText('Add at least one option to create the poll');
  await page.getByRole('button', { name: 'Book club', exact: true }).click();
  await expect(page.locator('#title')).toHaveValue('Book club');
  await expect(page.locator('#summary')).toHaveText('Add at least one option to create the poll');
  await addOptions(page, 1);
  await expect(page.locator('#submit')).toHaveAttribute('aria-disabled', 'false');
  await page.click('#submit');
  await openNewPoll(page);
  await expect(page.locator('#ev-title')).toHaveText('Book club');
});

test('ask when people are available: a template’s length is one of the pills, and it names the poll', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.click('[data-occasion="0"]'); // Dinner: two hours
  await pickDays(page, 14);
  await expect(page.locator('#summary')).toHaveText('14 days to choose from');
  await setLevel(page, 'hours');
  // Hours are for short plans: 30 minutes, an hour or two. Longer ones suit parts of the day.
  await expect(page.locator('[data-flength]')).toHaveText(['30 min', '1 hour', '2 hours']);
  await expect(page.locator('[data-flength="120"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-flength][aria-pressed="true"]')).toHaveCount(1);
  await page.click('[data-occasion="0"]'); // off again
  await page.click('[data-occasion="2"]'); // Coffee: an hour
  await expect(page.locator('[data-flength="60"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-occasion="5"]'); // Game night: three hours, so the longest there is
  await expect(page.locator('[data-flength="120"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-flength][aria-pressed="true"]')).toHaveCount(1);
});

test('marking many as if needed is folded away under the calendar, and works on both create pages', async ({
  page,
  isMobile,
}) => {
  await page.goto('/new/pick');
  await page.fill('#title', 'Dinner');
  // No switch at the top of "When could it be?": the hint, the key, then the calendar.
  await expect(page.locator('.pick-brush, [data-pbrush], [data-fbrush]')).toHaveCount(0);
  await expect(page.locator('#brush-box')).not.toHaveAttribute('open', '');
  await expect(page.locator('#brush')).toBeHidden();
  const day = addDays(await todayIn(page), 3);
  const add = async (at) => {
    await page.fill('#at-day', day);
    await page.selectOption('#at-time', String(at));
    await page.click('#at-add');
  };
  await add(1140);
  await page.click('#brush-box summary');
  const sw = page.getByRole('switch', { name: 'New ones are if needed for you' });
  await sw.check();
  await add(1020);
  await add(780);
  // Folded away again, it still says it's on.
  await page.click('#brush-box summary');
  expect(await brushOn(page)).toBe(true);
  await expect(page.locator('#options-list .chip.maybe')).toHaveCount(2);
  await page.click('#brush-box summary');
  await sw.uncheck();
  expect(await brushOn(page)).toBe(false);
  await add(600);
  await expect(page.locator('#options-list .chip.maybe')).toHaveCount(2);
  await expect(page.locator('#options-list .chip.yes')).toHaveCount(2);

  // "Ask when people are available": days picked with it on are if needed.
  await page.goto('/new/free');
  await expect(page.locator('.pick-brush, [data-pbrush], [data-fbrush]')).toHaveCount(0);
  await page.click('#brush-box summary');
  await page.check('#brush');
  await tapDays(page, await weekendsFrom(page, 2));
  await expect(page.locator('#free-list .chip:not(.maybe)')).toHaveCount(0);
  await expect(page.locator('.cal-day.day-maybe').first()).toBeVisible();
  await page.uncheck('#brush');
  await setLevel(page, 'parts');
  // Zoomed in, what was if needed stays so; new picks are available again.
  await expect(page.locator('#free-list .chip.maybe').first()).toBeVisible();
  await expect(page.locator('#free-list .chip:not(.maybe)')).toHaveCount(0);
  if (!isMobile) {
    await page.click('#q-clear');
    await page.locator('#when .pg-cell.part').first().click();
    await expect(page.locator('#free-list .chip:not(.maybe)')).toHaveCount(1);
  }
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
    ['Gym', 60],
    ['Run', 60],
    ['Bike', 120],
    ['Golf', 240],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#title')).toHaveAttribute('placeholder', name);
    await expect(page.locator(`[data-length="${length}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#other-box summary')).toHaveText('Custom');
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
  await expect(page.locator('section', { hasText: 'From visit to poll' })).toContainText('Create a Venn');
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
  await page.locator('.final-cal summary').click();
  await expect(page.locator('#cal-add-h')).toHaveText('Add it to your calendar, with everyone invited');
  await expect(page.locator('#cal-add-hint')).toContainText('invite the 2 people who answered');
  const google = new URL(await page.getByRole('link', { name: 'Google Calendar' }).getAttribute('href'));
  expect(google.searchParams.get('add')).toBe('ana@example.com,jo@example.com');
  // The iCal file is made in the page, with everyone in it, so the emails never go in a link.
  const ical = page.getByRole('link', { name: /iCal/ });
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
  await page.locator('.final-extras summary').click(); // under "More"
  const button = page.locator('.final-extras').getByRole('button', { name: /as a picture$/ });
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
  await page.locator('.final-extras summary').click();
  expect((await save(button)).size).toEqual([1080, 1920]);
  await expect(button).toHaveAttribute('data-card-faces', '0');
  // Names hidden: not even the organizer's picture shows them.
  const anonymous = await picked({ hideNames: true });
  await page.goto(`/e/${anonymous.id}#admin=${anonymous.adminToken}`);
  await page.locator('.final-extras summary').click();
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
  // Then one that only works if needed: a second tap.
  await page.mouse.click((await col(3)).x + 10, grid.y + 10);
  await page.locator('.tg-col').nth(3).locator('.tg-block').click();
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
  // Marking many as if needed is folded away under the calendar; switched on, new ones are if needed.
  await page.click('#brush-box summary');
  await page.getByRole('switch', { name: 'New ones are if needed for you' }).check();
  expect(await brushOn(page)).toBe(true);
  await page.selectOption('#at-time', '1020');
  await page.click('#at-add');
  const blocks = page.locator(`#picker .tg-col[data-date="${day}"] .tg-block`);
  await expect(blocks).toHaveCount(2);
  await expect(blocks.locator('small')).toHaveText(['If needed', 'Available']);

  // A trip that's only if needed is amber on every day, and each day says so.
  await page.click('[data-length="days"]');
  await showNextMonth(page);
  // A week into next month, clear of the times above (which can fall on the 1st).
  const first = addDays(await nextMonth(page), 7);
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
        emoji: '🍝',
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
  // Finn celebrates, with two real buttons: everyone's answers, and making your own poll.
  await expect(page.locator('.party [role=status]')).toContainText("Finn is so glad you're in");
  const go = page.locator('.party-go');
  await expect(go).toHaveText('See everyone’s answers');
  await expect(go).toBeFocused();
  const own = page.getByRole('link', { name: 'Planning something? Make yours in 30 seconds' });
  await expect(own).toBeVisible();
  // Straight to a new Venn, with the same template.
  await expect(own).toHaveAttribute('href', `/new?from=guest&template=${encodeURIComponent('🍝')}`);
  // Both are full-size buttons that fit a phone, and Tab goes round them.
  for (const b of [go, own]) {
    const box = await b.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  }
  await page.keyboard.press('Tab');
  await expect(own).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(go).toBeFocused();
  await own.click();
  await expect(page).toHaveURL(/\/new\?from=guest$/);
  await expect(page.locator('.party')).toHaveCount(0);
  // Their name and the template are filled in: only the dates are left to choose.
  await expect(page.getByRole('button', { name: 'Dinner' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#organizer')).toHaveValue('Ana');

  // Once the date is picked, guests can make their own, under More.
  await request.post(`/api/events/${id}/finalize`, { data: { start: t0 }, headers: { 'x-admin-token': adminToken } });
  await page.goto(`/e/${id}`);
  await page.locator('.final-extras summary').click();
  await expect(page.locator(`.final-extras a[href="/new?from=set&template=${encodeURIComponent('🍝')}"]`)).toHaveText(
    'Make your own Venn',
  );
  // The organizer's banner keeps to telling everyone: no "Plan the next one", and no "Repeats" choice.
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await page.locator('.final-extras summary').click();
  await expect(page.locator('.banner-final').getByText('Plan the next one')).toHaveCount(0);
  await expect(page.locator('#repeat-sel')).toHaveCount(0);
  await expect(page.getByText('Repeats', { exact: true })).toHaveCount(0);
});

test('the organizer plans the next one in one tap, then brings last time’s group back', async ({ page, request }) => {
  // A book club on Tuesday Jan 7 2025, 6pm UTC (long gone), asking everyone for their email.
  const t0 = Date.UTC(2025, 0, 7, 18);
  const H = 3_600_000;
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: {
        title: 'Book club',
        emoji: '📚',
        organizer: 'Sam',
        location: 'The library',
        description: 'Bring the book',
        timezone: 'UTC',
        mode: 'options',
        requireEmail: true,
        hostAnswers: true,
        options: [
          { start: t0, end: t0 + 2 * H },
          { start: t0 + 24 * H, end: t0 + 26 * H },
        ],
      },
    })
  ).json();
  await request.post(`/api/events/${id}/participants`, {
    data: { name: 'Ana', email: 'ana@example.com', availability: { [t0]: 2 } },
  });
  await request.post(`/api/events/${id}/finalize`, { data: { start: t0 }, headers: { 'x-admin-token': adminToken } });

  // Once the date is set, the organizer tools wait closed; their Duplicate poll plans the next one.
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('details.organizer')).not.toHaveAttribute('open', '');
  await page.locator('details.organizer summary').click();
  await page.getByRole('link', { name: 'Duplicate poll' }).click();

  // The create page has everything, with the dates moved on by whole weeks: still a Tuesday and Wednesday.
  await expect(page).toHaveURL(new RegExp(`/new/pick\\?copy=${id}&next$`));
  await expect(page.locator('#create h1')).toHaveText('Plan the next one');
  await expect(page.locator('#title')).toHaveValue('Book club');
  await expect(page.locator('#location')).toHaveValue('The library');
  await expect(page.locator('#desc')).toHaveValue('Bring the book');
  await expect(page.locator('[data-occasion="3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#p-email')).toBeChecked();
  await expect(page.locator('#summary')).toHaveText('2 options to vote on');
  await page.click('#submit');

  // The celebration offers to email last time's group, in BCC.
  const mail = page.getByRole('link', { name: 'Email last time’s group' });
  await expect(mail).toHaveAttribute('href', /^mailto:\?bcc=ana%40example\.com&subject=Book%20club&body=/);
  await page.getByRole('button', { name: 'View poll' }).click();
  await expect(page).toHaveURL(/\/e\/\w+$/);
  const next = page.url().split('/e/')[1];
  const ev = await (await request.get(`/api/events/${next}`)).json();
  const D = 24 * H;
  const [a, b] = ev.options;
  expect([new Date(a.start).getUTCDay(), new Date(a.start).getUTCHours(), a.end - a.start]).toEqual([2, 18, 2 * H]);
  expect(b.start - a.start).toBe(D);
  expect(a.start).toBeGreaterThan(Date.now());
  expect([ev.repeat, ev.seriesOf, ev.requireEmail, ev.emoji]).toEqual([undefined, id, true, '📚']);

  // The new poll's page brings the group back too.
  const box = page.locator('#series-box');
  await expect(box).toContainText('1 person answered “Book club” last time.');
  await expect(box.getByRole('link', { name: 'Email last time’s group' })).toHaveAttribute('href', /bcc=ana%40example\.com/);
  await expect(box.getByRole('button', { name: 'Share the link' })).toBeVisible();
});

test('a copy of a poll whose dates have passed moves them on by whole weeks', async ({ page, request }) => {
  // Two Tuesdays in the past, at 6pm UTC.
  const t0 = Date.UTC(2025, 0, 7, 18);
  const H = 3_600_000;
  const { id } = await (
    await request.post('/api/events', {
      data: {
        title: 'Run club',
        timezone: 'UTC',
        mode: 'options',
        options: [
          { start: t0, end: t0 + H },
          { start: t0 + 7 * 24 * H, end: t0 + 7 * 24 * H + H },
        ],
      },
    })
  ).json();
  await page.goto(`/new/pick?copy=${id}`);
  await expect(page.locator('#title')).toHaveValue('Run club');
  await page.fill('#organizer', 'Sam');
  await expect(page.locator('#summary')).toHaveText('2 options to vote on');
  await page.click('#submit');
  await page.getByRole('button', { name: /^(View poll|Open .+ →)$/ }).click();
  await expect(page).toHaveURL(/\/e\/\w+$/);
  const ev = await (await request.get(`/api/events/${page.url().split('/e/')[1]}`)).json();
  // Still Tuesdays at 6pm, a week apart, and still to come.
  for (const o of ev.options) {
    expect(new Date(o.start).getUTCDay()).toBe(2);
    expect(new Date(o.start).getUTCHours()).toBe(18);
    expect(o.start).toBeGreaterThan(Date.now());
  }
  expect(ev.options[1].start - ev.options[0].start).toBe(7 * 24 * H);
  expect(ev.repeat).toBeUndefined();
});

/** A whole-day poll through the API: `n` days from `from` (a Sunday, Jan 6, 2030), in UTC. */
async function daysPoll(request, { n = 14, days = 1, from = '2030-01-06' } = {}) {
  const dates = Array.from({ length: n }, (_, i) => addDays(from, i));
  const res = await request.post('/api/events', {
    data: {
      title: 'Cabin weekend',
      organizer: 'Sam',
      timezone: 'UTC',
      dates,
      startMinute: 0,
      endMinute: 1440,
      slotMinutes: 1440,
      durationMinutes: days * 1440,
    },
  });
  return res.json();
}
const dayKey = (date) => String(Date.parse(`${date}T00:00:00Z`));

test('guests answer a whole-day poll on a calendar of its days: tap, tap again, tap to clear; blank days are a no', async ({
  page,
  request,
}) => {
  // One day at a time (trips, days in a row, have a test of their own).
  const { id, adminToken } = await daysPoll(request, { days: 1, from: '2030-01-08' }); // a Tuesday
  await page.goto(`/e/${id}`);
  const day = (d) => page.locator(`button.dcal-day[data-date="${d}"]`);
  // The calendar is the guest's way to answer, with the create page's key; the list is a tap away.
  await expect(page.locator('[data-mine-view="calendar"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#mine')).toBeHidden();
  await expect(page.locator('.tap-key')).toHaveText(
    /Tap: available\s*Tap again: if needed\s*Tap again, or leave blank: unavailable/,
  );
  await expect(page.locator('button.dcal-day')).toHaveCount(14);
  await expect(page.locator('.dcal-off').first()).toBeVisible(); // other days of those weeks, dimmed
  await expect(page.locator('.dcal-month')).toHaveText(['January 2030']);
  await expect(day('2030-01-08')).toHaveAccessibleName(/Tuesday 8 Jan/);
  // Yes to all, None of these work and Clear wait under the days.
  const lastDay = await day('2030-01-21').boundingBox();
  expect((await page.locator('#fill').boundingBox()).y).toBeGreaterThan(lastDay.y);

  await day('2030-01-08').click();
  await expect(day('2030-01-08')).toHaveAttribute('aria-pressed', 'true');
  await expect(day('2030-01-08')).toContainText('Yes');
  await day('2030-01-09').click();
  await day('2030-01-10').click();
  await day('2030-01-10').click();
  await expect(day('2030-01-10')).toHaveAttribute('aria-pressed', 'mixed');
  await expect(day('2030-01-10')).toContainText('If needed');
  for (let i = 0; i < 3; i++) await day('2030-01-11').click(); // available, if needed, cleared
  await expect(day('2030-01-11')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#my-picks')).toContainText('2 yes, 1 if needed, no to the other 11');
  await expect(page.locator('#save-state')).toHaveText('Add your name to submit.');
  await page.fill('#name', 'Ana');
  await expect(page.locator('#save-state')).toHaveText('Ready to submit');
  // Every day has an answer (blank is no), so Submit sends it without asking first.
  await page.click('#save');
  await expect(page.locator('.party [role=status]')).toContainText('Answer submitted!');
  await expect(page.locator('#submit-check')).toBeHidden();
  await page.click('.party-go');
  const ev = await (await request.get(`/api/events/${id}`, { headers: { 'x-admin-token': adminToken } })).json();
  const ana = ev.participants.find((p) => p.name === 'Ana');
  expect(ana.availability).toEqual({ [dayKey('2030-01-08')]: 2, [dayKey('2030-01-09')]: 2, [dayKey('2030-01-10')]: 1 });
  await expect(page.locator('.best-hero')).toContainText('Jan 8');

  // The organizer answers on the list, as before.
  await page.goto(`/e/${id}#admin=${adminToken}`);
  if (await page.locator('#tab-mine').isVisible()) await page.click('#tab-mine');
  await expect(page.locator('#mine .row')).toHaveCount(14);
  await expect(page.locator('.poll-head #copy')).toBeVisible();
});

test('the days calendar works from the keyboard, says each day and its answer, and the list shows the same', async ({
  page,
  request,
}) => {
  const { id, adminToken } = await daysPoll(request);
  await page.goto(`/e/${id}`);
  const day = (d) => page.locator(`button.dcal-day[data-date="${d}"]`);
  // One tab stop for the whole calendar: arrows move, Space and Enter answer.
  await expect(page.locator('button.dcal-day[tabindex="0"]')).toHaveCount(1);
  await day('2030-01-06').focus();
  await page.keyboard.press('ArrowRight');
  await expect(day('2030-01-07')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(day('2030-01-14')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(day('2030-01-14')).toHaveAttribute('aria-pressed', 'true');
  await expect(day('2030-01-14')).toHaveAccessibleName(/Monday 14 Jan\s?, Yes/);
  await page.keyboard.press('Enter');
  await expect(day('2030-01-14')).toHaveAttribute('aria-pressed', 'mixed');
  await expect(day('2030-01-14')).toHaveAccessibleName(/If needed/);
  await expect(day('2030-01-14')).toBeFocused();
  await page.keyboard.press('End');
  await expect(day('2030-01-19')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(day('2030-01-06')).toBeFocused();
  // The list says the same: if needed on the 14th, no on the days left blank.
  await page.click('[data-mine-view="list"]');
  await expect(page.locator('#mine .row')).toHaveCount(14);
  await expect(page.locator('#mine .row').nth(8)).toHaveAttribute('data-v', '1');
  await expect(page.locator('#mine .row').nth(0)).toHaveAttribute('data-v', '0');
  await page.click('[data-mine-view="calendar"]');
  await expect(day('2030-01-14')).toHaveAttribute('aria-pressed', 'mixed');

  // "None of these work" still answers, straight away.
  await page.click('#decline');
  await expect(day('2030-01-14')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#my-picks')).toContainText('none of these work');
  await page.fill('#name', 'Jo');
  await expect(page.locator('#save-state')).toHaveText('Ready to submit');
  await submit(page);
  await expect(page.locator('#save-state')).toHaveText('Submitted');
  const ev = await (await request.get(`/api/events/${id}`, { headers: { 'x-admin-token': adminToken } })).json();
  expect(ev.participants.find((p) => p.name === 'Jo').availability).toEqual({});
});

test('Submit asks "are you sure?" only when some options have no answer, and the bar says how far along it is', async ({
  page,
  request,
}) => {
  const t0 = Date.UTC(2030, 0, 8, 18);
  const options = [0, 1, 2].map((d) => ({ start: t0 + d * 86_400_000, end: t0 + d * 86_400_000 + 7_200_000 }));
  const { id } = await (
    await request.post('/api/events', { data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options } })
  ).json();
  await page.goto(`/e/${id}`);
  const row = (i) => page.locator('#mine .row').nth(i);
  const state = page.locator('#save-state');
  const check = page.locator('#submit-check');
  await row(0).locator('[data-vote="2"]').click();
  await expect(state).toHaveText('1 of 3 answered. Add your name to submit.');
  await page.fill('#name', 'Ana');
  await expect(state).toHaveText('1 of 3 answered');
  // A partial answer: asked first, showing who's answering and what; Go back changes nothing.
  await page.click('#save');
  await expect(check).toBeVisible();
  await expect(check.locator('h2')).toHaveText('Submit your answer?');
  await expect(check).toContainText('Answering as Ana.');
  await expect(check).toContainText('2 not answered, counted as no');
  await expect(check.locator('#sc-yes')).toBeFocused();
  await check.locator('#sc-no').click();
  await expect(check).toBeHidden();
  await expect(state).toHaveText('1 of 3 answered');
  // Every option answered: ready, and Submit sends it straight away.
  await row(1).locator('[data-vote="0"]').click();
  await row(2).locator('[data-vote="1"]').click();
  await expect(state).toHaveText('Ready to submit');
  await expect(state).toHaveClass('ok');
  await page.click('#save');
  await expect(page.locator('.party [role=status]')).toContainText('Answer submitted!');
  await expect(check).toBeHidden();
  await page.click('.party-go');
  await expect(state).toHaveText('Submitted');
  // Changing it later: still no question when everything has an answer.
  if (await page.locator('#tab-mine').isVisible()) await page.click('#tab-mine');
  await row(2).locator('[data-vote="2"]').click();
  await expect(state).toHaveText('Ready to submit');
  await page.click('#save');
  await expect(page.locator('.party [role=status]')).toContainText('Answer updated!');
});

test('guests see the first option sooner: share at the bottom, no view switch for a short poll, quick answers under the options', async ({
  page,
  request,
}) => {
  const t0 = Date.UTC(2030, 0, 8, 18);
  const options = [0, 1, 2].map((d) => ({ start: t0 + d * 86_400_000, end: t0 + d * 86_400_000 + 7_200_000 }));
  const { id, adminToken } = await (
    await request.post('/api/events', { data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options } })
  ).json();
  await page.goto(`/e/${id}`);
  await expect(page.locator('#mine .row')).toHaveCount(3);
  // The invite link is under everything else, not in the header.
  await expect(page.locator('.poll-head #copy')).toHaveCount(0);
  const share = page.locator('.guest-share #copy');
  await expect(share).toHaveText(/Copy invite link|Share the poll/);
  const panels = await page.locator('.panels').boundingBox();
  expect((await share.boundingBox()).y).toBeGreaterThan(panels.y + panels.height - 1);
  expect((await share.boundingBox()).height).toBeGreaterThanOrEqual(44);
  // Three options are just a list, and "Yes to all" and the rest come after them.
  await expect(page.locator('[data-mine-view]')).toHaveCount(0);
  const last = await page.locator('#mine .row').nth(2).boundingBox();
  for (const b of ['#fill', '#decline', '#none']) expect((await page.locator(b).boundingBox()).y).toBeGreaterThan(last.y);
  await page.click('#fill');
  await expect(page.locator('#mine .row[data-v="2"]')).toHaveCount(3);

  // The organizer's view keeps Share at the top, and the calendar switch.
  await page.goto(`/e/${id}#admin=${adminToken}`);
  if (await page.locator('#tab-mine').isVisible()) await page.click('#tab-mine');
  await expect(page.locator('.poll-head #copy')).toBeVisible();
  await expect(page.locator('.guest-share')).toHaveCount(0);
  await expect(page.locator('[data-mine-view]')).toHaveCount(2);
});

test('on a phone, the word on each marked day fits on one line', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/new/free');
  await pickDays(page, 14);
  // In a wide font too, as some phones and Linux use.
  await page.addStyleTag({ content: ".cal-day small { font-family: 'DejaVu Sans', Verdana, sans-serif !important }" });
  const words = page.locator('.cal-day.marked small');
  await expect(words.first()).toBeVisible();
  for (const w of await words.all()) {
    const { lines, clipped } = await w.evaluate((el) => ({
      lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '1')),
      // Wider than its own box, or than the day it's in.
      clipped: el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().width > el.parentElement.clientWidth,
    }));
    expect(clipped).toBe(false);
    expect(lines).toBeLessThanOrEqual(1);
  }
});

test('every poll starts with a name: a template renames it, and typing replaces it', async ({ page }) => {
  await page.goto('/new/pick');
  const title = page.locator('#title');
  await expect(title).toHaveValue('Get-together');
  // A template names it, and so does another; taking it off goes back.
  await page.getByRole('button', { name: 'Book club' }).click();
  await expect(title).toHaveValue('Book club');
  await page.getByRole('button', { name: 'Dinner' }).click();
  await expect(title).toHaveValue('Dinner');
  await page.getByRole('button', { name: 'Dinner' }).click();
  await expect(title).toHaveValue('Get-together');
  // Tapping the name selects it, so what's typed replaces it.
  await page.getByRole('button', { name: 'Dinner' }).click();
  await page.locator('#location').focus();
  await title.click();
  await page.keyboard.type('Sam’s birthday');
  await expect(title).toHaveValue('Sam’s birthday');
  // A name the organizer typed stays when they change the template.
  await page.getByRole('button', { name: 'Drinks' }).click();
  await expect(title).toHaveValue('Sam’s birthday');
  // Without a name at all, the poll is still made, named by its template.
  await title.fill('');
  await page.fill('#organizer', 'Sam');
  await addOptions(page, 1);
  await page.click('#submit');
  await openNewPoll(page);
  await expect(page.locator('#ev-title')).toHaveText('Drinks');
});

test("everyone's answers: each time shows its mix of available, if needed and unavailable, and the overlap has a tick", async ({
  page,
  request,
  isMobile,
}) => {
  // Three evenings, 6 to 8pm UTC. John can make them all; Seph only if needed on the second, not the third.
  const dates = ['2030-01-08', '2030-01-09', '2030-01-10'];
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: { title: 'Dinner', timezone: 'UTC', dates, startMinute: 1080, endMinute: 1200, slotMinutes: 30, durationMinutes: 60 },
    })
  ).json();
  const { slots } = await (await request.get(`/api/events/${id}`)).json();
  const day = (s) => new Date(s).toISOString().slice(0, 10);
  const answer = (pick) => Object.fromEntries(slots.map((s) => [s, pick(day(s))]).filter(([, v]) => v));
  for (const [name, availability] of [
    ['John', answer(() => 2)],
    ['Seph', answer((d) => (d === dates[1] ? 1 : d === dates[2] ? 0 : 2))],
  ])
    await request.post(`/api/events/${id}/participants`, { data: { name, availability } });

  await page.goto(`/e/${id}#admin=${adminToken}`);
  if (isMobile) await page.click('#tab-group');
  // The list: a card a day, its timeline with the overlap in green, and the best stretch to tap.
  await expect(page.locator('.ov-summary')).toContainText("Everyone's free");
  const cards = page.locator('.ov-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).locator('.ov-slot.all')).toHaveCount(4);
  await expect(cards.nth(0).locator('.ov-row')).toContainText('✓ Everyone');
  await expect(cards.nth(1).locator('.ov-row')).toHaveAccessibleName(/1 of 2 available, 1 if needed/);
  await cards.nth(0).locator('.ov-row').click();
  await expect(cards.nth(0).locator('.ov-who')).toContainText('John');
  await expect(cards.nth(0).locator('[data-pick]')).toBeVisible();
  // The grid of half hours, a tap away.
  await page.click('[data-gview="grid"]');
  await expect(page.locator('#overlap')).toBeHidden();
  const cells = page.locator('#group .cell[data-slot]');
  await expect(cells).toHaveCount(12);
  // The overlap: the first evening, where both are available, ticked.
  await expect(page.locator('#group .cell.best.all')).toHaveCount(4);
  await expect(page.locator('#legend')).toContainText("Everyone's available");
  // The others say their mix, in words and colours.
  const ifNeeded = page.locator(`#group .cell[data-slot="${slots.find((s) => day(s) === dates[1])}"]`);
  await expect(ifNeeded).toHaveAccessibleName(/1 of 2 available, 1 if needed$/);
  expect(await ifNeeded.evaluate((el) => el.style.background)).toMatch(/var\(--yes\) 50%, var\(--maybe\) 50% 100%/);
  const no = page.locator(`#group .cell[data-slot="${slots.find((s) => day(s) === dates[2])}"]`);
  await expect(no).toHaveAccessibleName(/1 of 2 available, 1 unavailable$/);
  expect(await no.evaluate((el) => el.style.background)).toMatch(/var\(--no-cell\) 50%/);
  await expect(page.locator('#legend')).toContainText('If needed');
  await expect(page.locator('#legend')).toContainText('Unavailable');
});

test('a big group: a few people then "+N more", names a tap away, and ticks on the best times only', async ({
  page,
  request,
  isMobile,
}) => {
  // Six evenings, 6 to 8pm UTC, looking for 2 hours. Everyone can make the whole of the last one;
  // on the first, everyone's free for half an hour only, which isn't long enough.
  const dates = ['2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10', '2030-01-11', '2030-01-12'];
  const { id } = await (
    await request.post('/api/events', {
      data: {
        title: 'Book club',
        timezone: 'UTC',
        dates,
        startMinute: 1080,
        endMinute: 1200,
        slotMinutes: 30,
        durationMinutes: 120,
      },
    })
  ).json();
  const { slots } = await (await request.get(`/api/events/${id}`)).json();
  const day = (s) => new Date(s).toISOString().slice(0, 10);
  const firstHalfHour = slots[0];
  const names = ['Ana', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'];
  for (const [i, name] of names.entries()) {
    const availability = Object.fromEntries(
      slots.filter((s) => day(s) === dates[5] || s === firstHalfHour || (i % 2 && day(s) === dates[2])).map((s) => [s, 2]),
    );
    await request.post(`/api/events/${id}/participants`, { data: { name, availability } });
  }

  await page.goto(`/e/${id}`);
  if (isMobile) await page.click('#tab-group');
  // Six people, then "+4 more", which opens the rest.
  await expect(page.locator('#people .chip.person')).toHaveCount(6);
  await page.getByRole('button', { name: '+4 more' }).click();
  await expect(page.locator('#people .chip.person')).toHaveCount(10);
  await expect(page.locator('#people-more')).toHaveCount(0);
  await expect(page.locator('#people .person-btn').nth(6)).toBeFocused();

  // The best time says the count; the names are behind "See who".
  const hero = page.locator('.best-hero');
  await expect(hero).toContainText('Everyone can make it');
  await expect(hero.locator('.names')).toBeHidden();
  await hero.getByText('See who').click();
  await expect(hero.locator('.names')).toBeVisible();
  // The rest are in everyone's answers, not listed twice.
  await expect(page.locator('ol.best')).toHaveCount(0);
  await expect(page.locator('#best h3')).toHaveCount(0);

  // Only the 2 hours everyone can make are the Venn, not the lone half hour on the first evening.
  await expect(page.locator('.ov-slot.all')).toHaveCount(4);
  await expect(page.locator('.ov-card').nth(5).locator('.ov-slot.all')).toHaveCount(4);
  await page.click('[data-gview="grid"]');
  await expect(page.locator('#group .cell.best.all')).toHaveCount(4);
  for (const cell of await page.locator('#group .cell.best').all())
    expect(day(+(await cell.getAttribute('data-slot')))).toBe(dates[5]);
  await expect(page.locator(`#group .cell[data-slot="${firstHalfHour}"]`)).not.toHaveClass(/\bbest\b/);
  await expect(page.locator('#legend')).toContainText("Everyone's available");

  // On a phone the ticked evening, at the far right, is scrolled into view.
  if (isMobile) {
    const tick = await page.locator('#group .cell.best').first().boundingBox();
    const view = await page.locator('#panel-group .grid-scroll').boundingBox();
    expect(tick.x).toBeGreaterThanOrEqual(view.x);
    expect(tick.x + tick.width).toBeLessThanOrEqual(view.x + view.width + 1);
  }
});

test('a copied "when are you free" poll keeps its own length, even one there is no button for any more', async ({
  page,
  request,
}) => {
  const { id } = await (
    await request.post('/api/events', {
      data: {
        title: 'Game night',
        timezone: 'UTC',
        windows: [{ date: '2030-01-08', start: 1080, end: 1380 }],
        slotMinutes: 30,
        durationMinutes: 180,
      },
    })
  ).json();
  await page.goto(`/new/free?copy=${id}`);
  await expect(page.locator('[data-level="hours"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-flength="180"]')).toHaveText('3 hours');
  await expect(page.locator('[data-flength="180"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-flength]')).toHaveCount(4);
});

test('the week view goes a week with ‹ › and a month with « », never before this week', async ({ page }) => {
  await page.goto('/new/free');
  await setLevel(page, 'hours');
  await expect(page.locator('#when [data-view]:visible')).toHaveCount(0); // a week at a time, no Week / Day
  const first = () => page.locator('#when .tg-col').first().getAttribute('data-date');
  const today = await todayIn(page);
  const sunday = await first();
  expect(sunday <= today).toBe(true);
  await expect(page.getByRole('button', { name: 'Back a month' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next week' }).click();
  expect(await first()).toBe(addDays(sunday, 7));
  await page.getByRole('button', { name: 'Forward a month' }).click();
  // The week with the same day a month on.
  const shown = await first();
  const target = addMonths(addDays(sunday, 7), 1);
  expect(shown <= target && target < addDays(shown, 7)).toBe(true);
  await page.getByRole('button', { name: 'Back a month' }).click();
  await page.getByRole('button', { name: 'Back a month' }).click();
  expect(await first()).toBe(sunday); // back to this week, not before
});

test('Pick and the organizer tools are only on the organizer link; on the guest link the organizer sees what guests see', async ({
  page,
  context,
  request,
}) => {
  const start = Date.UTC(2031, 0, 6, 18);
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: { title: 'Dinner', timezone: 'UTC', mode: 'options', options: [{ start, end: start + 7_200_000 }] },
    })
  ).json();
  await request.post(`/api/events/${id}/participants`, { data: { name: 'Ana', availability: { [start]: 2 } } });

  await page.goto(`/e/${id}#admin=${adminToken}`);
  await expect(page.locator('[data-pick]').first()).toBeVisible();
  await expect(page.locator('.org-switch')).toHaveCount(0);
  // Reloading the tab keeps the organizer's tools.
  await page.reload();
  await expect(page.locator('[data-pick]').first()).toBeVisible();

  // The plain link, in another tab on the same device: what guests see, and no Pick.
  const guestTab = await context.newPage();
  await guestTab.goto(`/e/${id}`);
  await expect(guestTab.locator('.org-switch')).toContainText('This is what your guests see');
  await expect(guestTab.locator('[data-pick]')).toHaveCount(0);
  await expect(guestTab.locator('#tab-mine')).toHaveAttribute('aria-selected', 'true');
  // One tap back to the organizer's tools.
  await guestTab.getByRole('button', { name: 'Organizer view' }).click();
  await expect(guestTab.locator('[data-pick]').first()).toBeVisible();
  await expect(guestTab).toHaveURL(new RegExp(`/e/${id}$`)); // the secret doesn't stay in the address bar
});

test('creating a Venn: dates only on a month, date and time as parts or hours, and the optional extras', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Dinner');
  // Dates only: a month, Monday first, with no other views or quick picks to choose from.
  await expect(page.locator('[data-level="days"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-level]')).toHaveText(['Days', 'Parts of day', 'Hours']);
  await expect(page.locator('#when [data-cal-view]')).toHaveCount(0);
  await expect(page.locator('#when .cal-dow').first()).toHaveText('Mon');
  await expect(page.locator('#q-2w, #q-weekdays, #q-weekends')).toHaveCount(0);
  // Ten weekdays, tapped on the calendar.
  await pickDays(page, 10, (wd) => wd > 0 && wd < 6);
  await expect(page.locator('#summary')).toHaveText('10 days to choose from');

  // Parts of the day, a week at a time on phones too: no Week / Day to choose.
  await page.click('[data-level="parts"]');
  await expect(page.locator('[data-level="parts"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#when .pg-day')).toHaveCount(7);
  await expect(page.locator('#when [data-pview], #when .tv-views:visible')).toHaveCount(0);

  // Hours: how long is optional, under the calendar, off until chosen, and a second tap leaves it off again.
  await page.click('[data-level="hours"]');
  expect(await page.locator('#when').evaluate((w) => !!(w.compareDocumentPosition(document.getElementById('len-h')) & 4))).toBe(
    true,
  );
  await expect(page.locator('[data-flength][aria-pressed="true"]')).toHaveCount(0);
  await page.click('[data-flength="60"]');
  await expect(page.locator('[data-flength="60"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-flength="60"]');
  await expect(page.locator('[data-flength][aria-pressed="true"]')).toHaveCount(0);
  // Times are drawn on the calendar: no "from – to" or "every day this week" (after clearing the weekdays carried over).
  await expect(page.locator('#fr-add, #fr-from, [data-fill]')).toHaveCount(0);
  await page.click('#q-clear');
  await addHours(page, 1, [1080, 1140, 1200]);
  await expect(page.locator('#free-list')).toContainText('6 – 9 PM');
  await expect(page.locator('#summary')).toHaveText('1 day to choose from');
  // Days again keeps the days, and Hours brings the times back.
  await page.click('[data-level="days"]');
  await page.click('[data-level="hours"]');
  await expect(page.locator('#free-list')).toContainText('6 – 9 PM');
  await page.click('#submit');
  await expect(page).toHaveURL(/\/e\//);
  const id = page.url().split('/e/')[1];
  const ev = await (await page.request.get(`/api/events/${id}`)).json();
  expect(ev.durationMinutes).toBe(30); // no length: any overlap counts
});

test('a trip (days in a row): a guest marks the stretch in one tap, and fine-tunes a day', async ({ page, request }) => {
  const dates = Array.from({ length: 10 }, (_, i) => `2031-01-${String(3 + i).padStart(2, '0')}`); // Fri 3 – Sun 12
  const { id } = await (
    await request.post('/api/events', {
      data: {
        title: 'Cabin weekend',
        timezone: 'UTC',
        dates,
        startMinute: 0,
        endMinute: 1440,
        slotMinutes: 1440,
        durationMinutes: 3 * 1440,
      },
    })
  ).json();
  await page.goto(`/e/${id}`);
  if (!(await page.locator('.dcal').isVisible())) await page.click('[data-mine-view="calendar"]');
  await expect(page.locator('.tap-key')).toContainText('Tap a day: 3 days from it');
  const day = (d) => page.locator(`.dcal-day[data-date="2031-01-${String(d).padStart(2, '0')}"]`);
  // One tap: Fri 3 to Sun 5, joined as one band.
  await day(3).click();
  for (const d of [3, 4, 5]) await expect(day(d)).toHaveAttribute('data-v', '2');
  await expect(day(6)).toHaveAttribute('data-v', '0');
  await expect(day(3)).toHaveClass(/run-r/);
  await expect(page.locator('.dcal-trips')).toContainText('A trip that works for you');
  // A marked day changes on its own: Saturday only if needed.
  await day(4).click();
  await expect(day(4)).toHaveAttribute('data-v', '1');
  await expect(day(3)).toHaveAttribute('data-v', '2');
  // Near the end, the trip ends on the day tapped: Fri 10 to Sun 12.
  await day(12).click();
  for (const d of [10, 11, 12]) await expect(day(d)).toHaveAttribute('data-v', '2');
  await expect(page.locator('.dcal-trips .chip')).toHaveCount(2);
  await page.fill('#name', 'Ana');
  await submit(page);
  const ev = await (await request.get(`/api/events/${id}`)).json();
  const ana = ev.participants.find((p) => p.name === 'Ana');
  expect(Object.values(ana.availability).sort()).toEqual([1, 2, 2, 2, 2, 2]);
});

test('the picked date says so on its row, and the organizer changes it in two taps', async ({ page, request }) => {
  // Three evenings, as parts of the day; Ana can make the first two.
  const day = (d, h) => Date.UTC(2031, 0, d, h);
  const options = [6, 7, 8].map((d) => ({ start: day(d, 18), end: day(d, 22) }));
  const { id, adminToken } = await (
    await request.post('/api/events', { data: { title: 'Dinner', timezone: 'UTC', mode: 'options', layout: 'parts', options } })
  ).json();
  await request.post(`/api/events/${id}/participants`, {
    data: { name: 'Ana', availability: { [options[0].start]: 2, [options[1].start]: 2 } },
  });
  await request.post(`/api/events/${id}/finalize`, {
    data: { start: options[0].start },
    headers: { 'x-admin-token': adminToken },
  });

  // Guests see which one was picked.
  await page.goto(`/e/${id}`);
  if (await page.locator('#tab-group').isVisible()) await page.click('#tab-group');
  await expect(page.locator('.ov-row.final')).toHaveCount(1);
  await expect(page.locator('.ov-row.final')).toContainText('✓ Picked');
  await expect(page.locator('.ov-row').first()).toHaveClass(/final/);
  await expect(page.locator('#change-date')).toHaveCount(0);

  // The organizer: Change, under the date, lists the other evenings right in the banner; picking one
  // asks first, saying what a change means for calendars (in the page: some in-app browsers block confirm()).
  await page.goto(`/e/${id}#admin=${adminToken}`);
  const asked = [];
  page.on('dialog', (d) => asked.push(d.message()));
  await page.getByRole('button', { name: 'Change the date' }).click();
  await page.locator('#change-list li').first().getByRole('button', { name: 'Pick' }).click();
  await expect(page.locator('#pick-check')).toContainText(
    'Anyone who added the old date to their calendar will need to update it',
  );
  await page.click('#pc-yes');
  await expect(page.locator('#toast')).toContainText('Date changed');
  expect(asked).toEqual([]);
  await expect(page.locator('.banner-final h2')).toContainText('Jan 7');
  await expect(page.locator('.ov-row').nth(1)).toContainText('✓ Picked');
  const ev = await (await request.get(`/api/events/${id}`)).json();
  expect(ev.finalStart).toBe(options[1].start);
});

test('days and times mix: a day keeps the hours drawn on it, and days added after are all day', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Dinner');
  const first = await nextMonth(page);
  // 6 to 9 PM on the 1st, drawn on the hours calendar.
  await setLevel(page, 'hours');
  await addHours(page, 1, [1080, 1140, 1200]);
  await expect(page.locator('#free-list')).toContainText('6 – 9 PM');
  // Back on the days, two more days: the 1st keeps its times.
  await setLevel(page, 'days');
  await tapDays(page, [addDays(first, 2), addDays(first, 3)]);
  await expect(page.locator(`#when .cal-day[data-date="${first}"] small`)).toHaveText('Times');
  await expect(page.locator(`#when .cal-day[data-date="${addDays(first, 2)}"] small`)).toHaveText('Available');
  await expect(page.locator('#free-list .mix-note')).toContainText('6 – 9 PM');
  await expect(page.locator('#free-list .mix-note')).toContainText('The other days are all day.');
  await expect(page.locator('#summary')).toHaveText('3 days to choose from');
  // Created: one poll with the times, and the two days whole.
  await page.click('#submit');
  await expect(page).toHaveURL(/\/e\//);
  const ev = await (await page.request.get(`/api/events/${page.url().split('/e/')[1]}`)).json();
  expect(ev.windows).toEqual([
    { date: first, start: 1080, end: 1260 },
    { date: addDays(first, 2), start: 540, end: 1320 },
    { date: addDays(first, 3), start: 540, end: 1320 },
  ]);
});

test('days and parts of the day mix: an evening stays an evening, and a day added after is the whole day', async ({ page }) => {
  await page.goto('/new/free');
  await page.fill('#organizer', 'Sam');
  await page.fill('#title', 'Drinks');
  // A Monday of next month, so its week is on the calendar.
  const next = await nextMonth(page);
  const monday = addDays(next, (8 - new Date(`${next}T12:00:00Z`).getUTCDay()) % 7);
  await tapDays(page, [monday]);
  // Parts of the day: only the evening that Monday.
  await setLevel(page, 'parts');
  for (const r of [0, 1]) await page.locator(`#when .pg-cell[data-d="${monday}"][data-r="${r}"]`).click(); // available, then if needed
  for (const r of [0, 1]) await page.locator(`#when .pg-cell[data-d="${monday}"][data-r="${r}"]`).click(); // then off
  await expect(page.locator('#summary')).toHaveText('1 time to choose from');
  // Back on the days, the Wednesday: the Monday keeps its evening.
  await setLevel(page, 'days');
  await tapDays(page, [addDays(monday, 2)]);
  await expect(page.locator('#free-list .mix-note')).toContainText('Evening');
  await page.click('#submit');
  await expect(page).toHaveURL(/\/e\//);
  const ev = await (await page.request.get(`/api/events/${page.url().split('/e/')[1]}`)).json();
  expect(ev.layout).toBe('parts');
  expect(ev.options).toHaveLength(4); // Monday's evening, and Wednesday's morning, afternoon and evening
});
