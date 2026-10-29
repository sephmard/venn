// Shared steps for the browser tests.

import { expect } from '@playwright/test';

/** The first day of next month, in the browser's time zone, so every day used is in the future. */
export const nextMonth = (page) =>
  page.evaluate(() => {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
  });

/** On a month calendar, show next month (it may open there already, late in a month). */
export async function showNextMonth(page) {
  const first = await nextMonth(page);
  if (!(await page.locator(`.cal-day[data-date="${first}"]`).count())) await page.click('[data-nav="1"]');
}

/** Today, in the browser's time zone. */
export const todayIn = (page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

export const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** On the create page's week (or day) calendar, go forward until `date` is shown. `root` is the
 * calendar's box: #picker on "vote on a few dates", #when on "Create a Venn". */
export async function showDate(page, date, root = '#picker') {
  // The calendar's extra navigation loads just after the page (day-nav.js) and draws it again.
  if (root === '#picker') await page.locator(`${root} .tv-pick`).waitFor();
  else await page.locator(`${root} .tg-col`).first().waitFor();
  const col = page.locator(`${root} .tg-col[data-date="${date}"]`);
  for (let i = 0; i < 60 && !(await col.count()); i++) {
    // ‹ › go a week at a time; on the day view, the strip's chips pick the day in that week.
    const chip = page.locator(`${root} .tv-chip[data-day="${date}"]`);
    if (await chip.isVisible()) {
      await chip.click();
      continue;
    }
    const shown = await page.locator(`${root} .tg-col`).first().getAttribute('data-date');
    await page.click(`${root} .tv-nav [data-step="${date < shown ? -1 : 1}"]`);
  }
  return col;
}

/** Tap the calendar at `minutes` after midnight on `date`: an option (or times) of the chosen length. */
export async function tapAt(page, date, minutes, root = '#picker') {
  const col = await showDate(page, date, root);
  const y = await col.evaluate((el, m) => {
    const row = parseFloat(getComputedStyle(el.closest('.tg')).getPropertyValue('--row')) || 24;
    const y = ((m - 420) / 30) * row + row / 2;
    el.closest('.tg-scroll').scrollTop = y - 2 * row;
    return y;
  }, minutes);
  await col.click({ position: { x: 6, y } });
}

/**
 * Add options to "vote on a few dates" on its calendar: the first `days` days of next month, at the
 * given start times (minutes after midnight).
 */
export async function addOptions(page, days, times = [1140]) {
  const first = await nextMonth(page);
  for (let i = 0; i < days; i++) for (const t of times) await tapAt(page, addDays(first, i), t);
}

/**
 * As the organizer, open the form for your own answer: on phones the poll starts on the group, and
 * an answer given with the poll shows as one line until "Change" is pressed.
 */
export async function changeAnswer(page) {
  await page.locator('#panel-mine').waitFor({ state: 'attached' });
  await expect(page.locator('.party')).toHaveCount(0, { timeout: 10_000 });
  if (await page.locator('#tab-mine').isVisible()) await page.click('#tab-mine');
  const change = page.locator('#org-change');
  if (await change.isVisible()) await change.click();
}

/**
 * Press Submit on a poll. When the answer can go in, confirm "Submit your answer?" if it's asked
 * (only when some options have no answer) and skip the celebration that follows; when something's
 * missing, the error says so and nothing more happens.
 */
export async function submit(page) {
  await page.click('#save');
  const yes = page.locator('#submit-check[open] #sc-yes');
  const err = page.locator('#save-err:not(:empty)');
  const go = page.locator('.party-go');
  await yes.or(err).or(go).first().waitFor();
  if (await err.isVisible()) return;
  if (await yes.isVisible()) await yes.click();
  await go.or(err).first().waitFor();
  if (await go.isVisible()) {
    await go.click();
    await page.locator('.party').waitFor({ state: 'detached' });
  }
}

// Address search in "Where": the test server has it off, so tests switch it on and answer for it.
const PLACES = {
  rosa: [
    {
      name: "Rosa's Pizza",
      detail: '374 Metropolitan Avenue, New York',
      label: "Rosa's Pizza, 374 Metropolitan Avenue, New York",
    },
    {
      name: "Rosa's Cantina",
      detail: 'Mission Street 12, San Francisco',
      label: "Rosa's Cantina, Mission Street 12, San Francisco",
    },
    { name: 'Rosario', detail: 'Argentina', label: 'Rosario, Argentina' },
  ],
};

/** Place search on, with `provider`; returns the searches the page made. */
export async function mockPlaces(page, provider = 'photon') {
  const searches = [];
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), places: provider } });
  });
  await page.route('**/api/places?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    searches.push(Object.fromEntries(params));
    const q = params.get('q').toLowerCase();
    route.fulfill({ json: { places: q.startsWith('ros') ? PLACES.rosa : [] } });
  });
  return searches;
}

/** The home page's contact form on (the test server has no email); returns the messages sent. */
export async function mockContact(page, reply = { status: 204 }) {
  const sent = [];
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), contact: true } });
  });
  await page.route('**/api/contact', (route) => {
    sent.push(route.request().postDataJSON());
    route.fulfill(reply);
  });
  return sent;
}

/** On the create page, how guests answer: 'days', 'parts' (of the day) or 'hours'. */
export async function setLevel(page, level) {
  await page.click(`[data-level="${level}"]`);
}

/**
 * Tap `n` days on the create page's month calendar, from the first that can be picked, moving on a
 * month when one runs out; `keep(weekday)` (0 is Sunday) skips the rest. Returns the days tapped.
 */
export async function pickDays(page, n, keep = () => true) {
  const picked = [];
  for (let month = 0; picked.length < n && month < 6; month++) {
    const days = await page.$$eval('#when .cal-day:not(:disabled)', (els) => els.map((e) => e.dataset.date));
    for (const d of days) {
      if (picked.length >= n) break;
      if (!keep(new Date(`${d}T12:00:00Z`).getUTCDay())) continue;
      await page.click(`#when .cal-day[data-date="${d}"]`);
      picked.push(d);
    }
    if (picked.length < n) await page.click('#when [data-nav="1"]');
  }
  return picked;
}

/** "Create a Venn" by hours: an hour from each of `times` on the first `days` days of next month (a tap
 * adds a half hour, so two taps each). */
export async function addHours(page, days, times = [1140]) {
  const first = await nextMonth(page);
  for (let i = 0; i < days; i++)
    for (const t of times) for (const m of [t, t + 30]) await tapAt(page, addDays(first, i), m, '#when');
}

/** Tap these days on the create page's month calendar, moving on a month when the next isn't shown. */
export async function tapDays(page, dates) {
  for (const d of dates) {
    const day = page.locator(`#when .cal-day[data-date="${d}"]`);
    for (let i = 0; i < 6 && !(await day.count()); i++) await page.click('#when [data-nav="1"]');
    await day.click();
  }
}

/** Fridays, Saturdays and Sundays: `weeks` weekends in a row, from the first Friday of next month. */
export async function weekendsFrom(page, weeks) {
  const first = await nextMonth(page);
  const friday = addDays(first, (5 - new Date(`${first}T12:00:00Z`).getUTCDay() + 7) % 7);
  return Array.from({ length: weeks }, (_, w) => [0, 1, 2].map((i) => addDays(friday, 7 * w + i))).flat();
}

/** On the poll page, as the organizer: open the organizer tools (closed until wanted). */
export async function openTools(page) {
  const tools = page.locator('details.organizer');
  await tools.waitFor();
  if ((await tools.getAttribute('open')) === null) await tools.locator('summary').click();
}
