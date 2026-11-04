// "Use AI" on Create a Venn: what the AI reads (from the stand-in in fake-anthropic.js) lands in
// the right mode, on the right days, with the right times, and the summary, the list guests choose
// from and the poll that's created all agree. Asking again, editing by hand and Undo behave.
import { test, expect } from '@playwright/test';
import { addDays, todayIn } from './helpers.js';

const DATE_NIGHT = 'I’m only free wed Thu and the weekend this week, create a date poll for a date night with my wife.';

/** This Monday-to-Sunday week's Wednesday, Thursday, Saturday and Sunday still to come, as the stand-in reads them. */
async function thisWeeksDays(page) {
  const today = await todayIn(page);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sunday
  const monday = addDays(today, dow === 0 ? -6 : 1 - dow);
  const hour = await page.evaluate(() => new Date().getHours());
  return [2, 3, 5, 6].map((n) => addDays(monday, n)).filter((d) => d > today || (d === today && hour < 22));
}

async function describe(page, text) {
  if (await page.locator('#ai-draft').isHidden()) await page.click('#ai-open');
  await page.fill('#ai-prompt', text);
  await page.click('#ai-go');
  await expect(page.locator('#ai-done')).toBeVisible();
}

test('AI: date night on the days they are free is evenings only on those days, through to the poll', async ({
  page,
  request,
}) => {
  await page.goto('/new');
  await page.fill('#organizer', 'Sam');
  const days = await thisWeeksDays(page);
  test.skip(!days.length, 'no Wednesday, Thursday or weekend evening left this week');
  await describe(page, DATE_NIGHT);

  // Parts of the day, evening only, on exactly those days.
  await expect(page.locator('[data-level="parts"]')).toHaveAttribute('aria-checked', 'true');
  const chips = page.locator('#free-list .chip');
  await expect(chips.first()).toBeVisible(); // days next to each other share a chip
  for (const chip of await chips.all()) await expect(chip).toContainText('Evening');
  await expect(page.locator('#free-list')).not.toContainText(/Morning|Afternoon|All day/);

  // The summary names the dates and the time window, and what it assumed.
  const done = page.locator('#ai-done');
  await expect(done.locator('.ai-done-head')).toHaveText('Date night 💕');
  await expect(done.locator('.ai-done-when')).toContainText(/^Evenings: /);
  const label = (d) =>
    new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T00:00:00Z`));
  for (const d of days) await expect(done.locator('.ai-done-when')).toContainText(await page.evaluate(label, d));
  await expect(done.locator('.ai-done-note')).toHaveText('Took date night as evenings.');

  // The poll that's created is the same: evenings, on those days, nothing else.
  await page.getByRole('button', { name: 'Create a Venn' }).click();
  await expect(page).toHaveURL(/\/e\/\w+/);
  const id = new URL(page.url()).pathname.split('/')[2];
  const ev = await (await request.get(`/api/events/${id}`)).json();
  expect(ev.layout).toBe('parts');
  const local = await page.evaluate(
    ({ options, tz }) =>
      options.map((o) => {
        const f = (ms) =>
          new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' })
            .format(ms)
            .replace(',', '');
        return `${f(o.start)} – ${f(o.end).split(' ')[1]}`;
      }),
    { options: ev.options, tz: ev.timezone },
  );
  expect(local).toEqual(days.map((d) => `${d} 18:00 – 22:00`));
});

test('AI: clock times become hours as given, and a trip becomes days in a row', async ({ page }) => {
  await page.goto('/new');
  await describe(page, 'Team sync Tuesday or Thursday 2-4pm');
  await expect(page.locator('[data-level="hours"]')).toHaveAttribute('aria-checked', 'true');
  // Late on a Tuesday, this Tuesday's 2–4 PM has passed, so only Thursday is left.
  await expect(page.locator('#ai-done .ai-done-when')).toHaveText(/^2 – 4 PM: \w+, \w+ \d+( · \w+, \w+ \d+)?$/);
  await expect(page.locator('#free-list')).toContainText('2 – 4 PM');
  await expect(page.locator('#free-list')).not.toContainText('All day');

  // Asking again replaces the draft, title included, since AI wrote it.
  await describe(page, 'Weekend trip to the lake, 3 days in a row');
  await expect(page.locator('#title')).toHaveValue('Lake trip');
  await expect(page.locator('[data-level="days"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#in-row')).toBeChecked();
  await expect(page.locator('#span')).toHaveValue('3');
  await expect(page.locator('#ai-done .ai-done-when')).toContainText(/^3 days in a row, from 4 days: /);
  await expect(page.locator('#ai-done .ai-done-note')).toHaveText('It replaced the last draft. Undo brings it back.');

  // Undo goes back to the draft before: the hours and their title.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#title')).toHaveValue('Team sync');
  await expect(page.locator('[data-level="hours"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#in-row')).not.toBeChecked();
  await expect(page.locator('#free-list')).toContainText('2 – 4 PM');
});

test('AI: days picked by hand are replaced, Undo brings them back exactly, and a typed name is kept', async ({ page }) => {
  await page.goto('/new');
  await page.fill('#title', 'Anniversary');
  // Pick two days by hand, the second only if needed.
  const day = page.locator('#when .cal-day:not(:disabled)');
  await day.nth(3).click();
  await day.nth(4).click();
  await day.nth(4).click(); // a second tap: if needed
  const picked = await page.locator('#free-list').innerText();
  expect(picked).toContain('If needed');
  await describe(page, 'Dinner, any Friday or Saturday evening');
  await expect(page.locator('#title')).toHaveValue('Anniversary'); // typed, so kept
  await expect(page.locator('[data-level="parts"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#ai-done .ai-done-note')).toHaveText('It replaced the days you had picked. Undo brings them back.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-level="days"]')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.locator('#free-list').innerText()).toBe(picked);
  await expect(page.locator('#title')).toHaveValue('Anniversary');
  await expect(page.locator('#ai-open')).toBeFocused();
});

test('AI: works from the keyboard, and a failed request leaves the box ready to try again', async ({ page }) => {
  await page.goto('/new');
  await page.locator('#ai-open').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ai-prompt')).toBeFocused();
  // The server is down for a moment: it says so, and the button works again.
  await page.route('**/api/ai/draft', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'The AI couldn’t respond. Try again later.' }),
    }),
  );
  await page.keyboard.type('Dinner, any Friday or Saturday evening');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('#ai-err')).toHaveText('The AI couldn’t respond. Try again later.');
  await expect(page.locator('#ai-go')).toBeEnabled();
  await expect(page.locator('#ai-wait')).toBeHidden();
  await page.unroute('**/api/ai/draft');
  // Try again: Ctrl or ⌘ + Enter in the box, then Tab to Undo.
  await page.locator('#ai-prompt').focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('#ai-done')).toBeVisible();
  await expect(page.locator('#ai-err')).toBeEmpty();
  await page.locator('#ai-undo').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ai-done')).toHaveCount(0);
  await expect(page.locator('#free-list .chip')).toHaveCount(0);
});

test('AI: when the free requests are used up, the key form also offers to carry on by hand', async ({ page }) => {
  await page.goto('/new');
  await page.route('**/api/ai/draft', (route) =>
    route.fulfill({
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Free AI requests are used up for this week. Add your own Anthropic API key to keep going.',
      }),
    }),
  );
  await page.click('#ai-open');
  await page.fill('#ai-prompt', 'Dinner, any Friday or Saturday evening');
  await page.click('#ai-go');
  await expect(page.locator('#ai-key-box')).toContainText('used up for this week');
  await expect(page.locator('#ai-key-box')).toContainText('No key?');
  await page.click('#ai-by-hand');
  // The AI box closes and the form it would have filled is next, ready to use.
  await expect(page.locator('#ai-draft')).toBeHidden();
  await expect(page.locator('#ai-open')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#title')).toBeFocused();
});

test('AI: a choice between things on Create a Venn moves to Vote, filled in, and nothing is created', async ({ page }) => {
  await page.goto('/new');
  const created = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/events') && created.push(r));
  await describe(page, 'Choose between Italian, Thai, and Mexican for dinner');
  await expect(page).toHaveURL(/\/new\/topic/);
  await expect(page.locator('#ai-done .ai-kind')).toHaveText('Venn made this a vote, because you asked for one.');
  await expect(page.locator('#title')).toHaveValue('Where should we eat?');
  const options = page.locator('#opts input');
  await expect(options).toHaveCount(3);
  expect(await options.evaluateAll((els) => els.map((e) => e.value))).toEqual(['Italian', 'Thai', 'Mexican']);
  await expect(page.locator('.kind-switch [aria-current]')).toHaveText('🗳️ Vote');
  expect(created).toHaveLength(0);
  // It makes a real vote with those options.
  await page.fill('#organizer', 'Sam');
  await page.click('#submit');
  await expect(page).toHaveURL(/\/e\//);
});

test('AI: "where and when" fills the evenings and offers to vote on where first', async ({ page }) => {
  await page.goto('/new');
  await describe(page, 'Let’s decide where and when to have dinner');
  await expect(page.locator('#free-list .chip').first()).toBeVisible();
  await expect(page.locator('#ai-undo')).toBeVisible();
  await page.getByRole('button', { name: 'Vote on it first' }).click();
  await expect(page).toHaveURL(/\/new\/topic/);
  await expect(page.locator('#title')).toHaveValue('Where should we have dinner?');
});

for (const words of ['Vote on our next book', 'Vote on our next book.'])
  test(`AI: "${words}" with no books named opens the vote with the question and two empty options`, async ({ page }) => {
    await page.goto('/new');
    await describe(page, words);
    await expect(page).toHaveURL(/\/new\/topic/);
    await expect(page.locator('#title')).toHaveValue('What should we read next?');
    const options = page.locator('#opts input');
    await expect(options).toHaveCount(2);
    expect(await options.evaluateAll((els) => els.map((e) => e.value))).toEqual(['', '']);
  });
