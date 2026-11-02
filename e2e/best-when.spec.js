import { test, expect } from '@playwright/test';

// Dates and times in big type never break in the middle of a range: on a phone, a part of the day
// sits under its date in body type ("Evening, 6 – 10 PM"), and the results rows keep "6 – 10 PM" whole.

test('the best evening on a phone: its date as the heading, the part and times whole underneath', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'UTC' });
  const page = await context.newPage();
  // A Wednesday in September, the longest short date there is.
  const evening = (d) => ({ start: Date.UTC(2037, 8, d, 18), end: Date.UTC(2037, 8, d, 22) });
  const options = [29, 30].map(evening);
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: { title: 'Book club', organizer: 'Sam', timezone: 'UTC', mode: 'options', layout: 'parts', options },
    })
  ).json();
  for (const name of ['Ana', 'Ben', 'Cai'])
    await request.post(`/api/events/${id}/participants`, {
      data: { name, availability: { [options[1].start]: 2, [options[0].start]: name === 'Ana' ? 2 : 1 } },
    });
  for (const url of [`/e/${id}#admin=${adminToken}`, `/e/${id}`]) {
    await page.goto(url);
    const best = page.locator('.best-when').first();
    await expect(best).toContainText('Wed, Sep 30');
    const part = best.locator('.bw-part');
    await expect(part).toHaveText(/^Evening, 6\s–\s10\sPM$/);
    // One line: no break inside "6 – 10 PM".
    const { height, lineHeight } = await part.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight) || 1.4 * parseFloat(getComputedStyle(el).fontSize),
    }));
    expect(height).toBeLessThan(lineHeight * 1.5);
    // The results rows: the range can't break either.
    const ranges = page.locator('.ov-when .nowrap');
    await expect(ranges.first()).toHaveText(/^6\s–\s10\sPM$/);
    // Each range is one box on screen: it didn't wrap.
    for (const lines of await ranges.evaluateAll((els) => els.map((el) => el.getClientRects().length))) expect(lines).toBe(1);
  }
  await context.close();
});
