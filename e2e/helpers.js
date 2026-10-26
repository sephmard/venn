// Shared steps for the browser tests.

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

/** On the create page's week (or day) calendar, go forward until `date` is shown. */
export async function showDate(page, date) {
  // The calendar's extra navigation loads just after the page (day-nav.js) and draws it again.
  await page.locator('#picker .tv-pick').waitFor();
  const col = page.locator(`#picker .tg-col[data-date="${date}"]`);
  for (let i = 0; i < 60 && !(await col.count()); i++) {
    // ‹ › go a week at a time; on the day view, the strip's chips pick the day in that week.
    const chip = page.locator(`#picker .tv-chip[data-day="${date}"]`);
    if (await chip.isVisible()) {
      await chip.click();
      continue;
    }
    const shown = await page.locator('#picker .tg-col').first().getAttribute('data-date');
    await page.click(`#picker .tv-nav [data-step="${date < shown ? -1 : 1}"]`);
  }
  return col;
}

/** Tap the calendar at `minutes` after midnight on `date`: an option of the chosen length. */
export async function tapAt(page, date, minutes) {
  const col = await showDate(page, date);
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
