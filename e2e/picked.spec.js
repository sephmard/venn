import { test, expect } from '@playwright/test';

// What people see is right: times in their own time zone and dates as dates, a picked date that's
// easy to change, and guests asked only about that date once it's picked.

const dates = ['2030-01-10', '2030-01-11', '2030-01-12'];
const day = (d) => Date.parse(`${d}T00:00:00-08:00`); // midnight in Los Angeles

async function datesPoll(request, answers) {
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: {
        title: 'Brunch',
        timezone: 'America/Los_Angeles',
        dates,
        startMinute: 0,
        endMinute: 1440,
        slotMinutes: 1440,
        durationMinutes: 1440,
      },
    })
  ).json();
  for (const [name, picks] of answers)
    await request.post(`/api/events/${id}/participants`, {
      data: { name, availability: Object.fromEntries(picks.map((d) => [day(d), 2])) },
    });
  return { id, adminToken };
}
const finalize = (request, id, adminToken, start) =>
  request.post(`/api/events/${id}/finalize`, { data: { start }, headers: { 'x-admin-token': adminToken } });

test.describe('far from the organizer', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('a dates poll reads as dates everywhere, with no clock times', async ({ page, request, isMobile }) => {
    const { id, adminToken } = await datesPoll(request, [['Ana', [dates[0], dates[1]]]]);
    await page.goto(`/e/${id}`);
    if (isMobile) await page.click('#tab-group');
    await expect(page.locator('#best')).toContainText('Thu, Jan 10');
    await expect(page.locator('#best')).not.toContainText(/AM|PM/);
    await finalize(request, id, adminToken, day(dates[1]));
    await page.reload();
    await expect(page.locator('#final-h')).toHaveText(/Fri, Jan 11/);
    await expect(page.locator('#final-h')).not.toHaveText(/AM|PM/);
  });

  test('a new poll is in this device’s time zone, with nothing to choose', async ({ page }) => {
    await page.goto('/new');
    await expect(page.locator('#tz')).toHaveValue('Europe/London');
    await expect(page.locator('#tz')).toBeHidden();
    await expect(page.getByText(/Times in .* · Change/)).toHaveCount(0);
  });
});

test('Change the date lists the next best dates, each one tap away, without a pop-up', async ({ page, request }) => {
  const { id, adminToken } = await datesPoll(request, [
    ['Ana', dates],
    ['Ben', [dates[0], dates[2]]],
  ]);
  await finalize(request, id, adminToken, day(dates[0]));
  page.on('dialog', () => {
    throw new Error('No pop-up expected');
  });
  await page.goto(`/e/${id}#admin=${adminToken}`);
  await page.locator('.final-extras summary').click();
  await page.click('#change-date');
  const rows = page.locator('#change-list li');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Sat, Jan 12');
  await expect(rows.first()).toContainText('2 of 2 can make it');
  await expect(page.locator('#change-list [data-pick]').first()).toBeFocused();
  // Keep this date closes it; Pick changes it.
  await page.click('#change-cancel');
  await expect(page.locator('#change-list')).toHaveCount(0);
  await page.locator('.final-extras summary').click();
  await page.click('#change-date');
  await rows.first().getByRole('button', { name: 'Pick' }).click();
  await expect(page.locator('#final-h')).toHaveText(/Sat, Jan 12/);
  await expect(page.locator('#change-list')).toHaveCount(0);
});

test('Add to calendar stays readable once tapped open', async ({ page, request }) => {
  const { id, adminToken } = await datesPoll(request, [['Ana', dates]]);
  await finalize(request, id, adminToken, day(dates[0]));
  await page.goto(`/e/${id}#admin=${adminToken}`);
  const add = page.locator('.final-cal > summary');
  await add.click();
  const [color, bg] = await add.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
  // Its text is white on the green banner: the button never turns white behind it.
  expect(bg).not.toBe('rgb(242, 238, 230)');
  expect(bg).not.toBe('rgb(255, 255, 255)');
  expect(color).toBe('rgb(255, 255, 255)');
});

test('once the date is picked, a new guest just says if they can make it', async ({ page, request }) => {
  const { id, adminToken } = await datesPoll(request, [['Ana', dates]]);
  await finalize(request, id, adminToken, day(dates[1]));
  await page.goto(`/e/${id}`);
  await expect(page.locator('#panel-mine h2')).toHaveText('The date is picked. Can you make it?');
  await expect(page.locator('#answer-full')).toBeHidden();
  const yes = page.locator('#answer-final [data-final-vote="2"]');
  await yes.click();
  await expect(yes).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#name', 'Riley');
  await page.click('#save');
  await expect(page.locator('.party')).toBeVisible();
  const ev = await (await request.get(`/api/events/${id}`)).json();
  expect(ev.participants.find((p) => p.name === 'Riley').availability).toEqual({ [day(dates[1])]: 2 });
});
