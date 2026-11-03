// Results that tell the truth: one answer reads as one answer, a trip's best stretch of days is
// marked as one run, and a tie for the best is said, not hidden.

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

const showGroup = async (page, isMobile) => {
  if (isMobile) await page.click('#tab-group');
};

test('a trip: the best days in a row are marked as one run, and the summary says how many days', async ({
  page,
  request,
  isMobile,
}) => {
  const dates = ['2030-03-01', '2030-03-02', '2030-03-03', '2030-03-04', '2030-03-05', '2030-03-06', '2030-03-07'];
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: {
        title: 'Cabin',
        timezone: 'UTC',
        dates,
        startMinute: 0,
        endMinute: 1440,
        slotMinutes: 1440,
        durationMinutes: 3 * 1440,
      },
    })
  ).json();
  const { slots } = await (await request.get(`/api/events/${id}`)).json();
  // Ana can do the 2nd to the 5th, Ben the 3rd to the 6th: both, the 3rd to the 5th.
  const free = (from, to) => Object.fromEntries(slots.slice(from, to + 1).map((s) => [s, 2]));
  for (const [name, availability] of [
    ['Ana', free(1, 4)],
    ['Ben', free(2, 5)],
  ])
    await request.post(`/api/events/${id}/participants`, { data: { name, availability } });

  await page.goto(`/e/${id}#admin=${adminToken}`);
  await showGroup(page, isMobile);
  await expect(page.locator('.ov-summary')).toContainText("Everyone's free for 3 days in a row");
  await expect(page.locator('.ov-summary')).not.toContainText(/free on \d/);
  const run = page.locator('#overlap .ov-item.in-run');
  await expect(run).toHaveCount(3);
  await expect(run.first()).toContainText(/Mar\D*3/);
  await expect(run.last()).toContainText(/Mar\D*5/);
  await expect(page.locator('#overlap .ov-run')).toHaveCount(1);
  await expect(run.first().locator('.ov-run')).toHaveText('Best 3 days');
});

test('one answer reads as one answer, not as everyone', async ({ page, request, isMobile }) => {
  const dates = ['2030-03-01', '2030-03-02', '2030-03-03'];
  const { id } = await (
    await request.post('/api/events', {
      data: { title: 'Lunch', timezone: 'UTC', dates, startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: 1440 },
    })
  ).json();
  const { slots } = await (await request.get(`/api/events/${id}`)).json();
  await request.post(`/api/events/${id}/participants`, {
    data: { name: 'Ana <b>', availability: { [slots[0]]: 2, [slots[1]]: 1 } },
  });

  await page.goto(`/e/${id}`);
  await showGroup(page, isMobile);
  await expect(page.locator('.ov-summary')).toHaveText('Only Ana <b> has answered so far.');
  const counts = page.locator('#overlap .ov-count');
  await expect(counts.nth(0)).toContainText('✓ Ana <b>');
  await expect(counts.nth(1)).toContainText('Ana <b>, if needed');
  await expect(page.locator('#overlap')).not.toContainText('Everyone');
});

test('a tie for the best date is said under it', async ({ page, request, isMobile }) => {
  const dates = ['2030-03-01', '2030-03-02', '2030-03-03', '2030-03-04'];
  const { id, adminToken } = await (
    await request.post('/api/events', {
      data: {
        title: 'Book club',
        timezone: 'UTC',
        dates,
        startMinute: 0,
        endMinute: 1440,
        slotMinutes: 1440,
        durationMinutes: 1440,
      },
    })
  ).json();
  const { slots } = await (await request.get(`/api/events/${id}`)).json();
  // Both are free on the 1st, 2nd and 3rd: three dates tie.
  const both = Object.fromEntries(slots.slice(0, 3).map((s) => [s, 2]));
  for (const name of ['Ana', 'Ben']) await request.post(`/api/events/${id}/participants`, { data: { name, availability: both } });

  await page.goto(`/e/${id}#admin=${adminToken}`);
  await showGroup(page, isMobile);
  await expect(page.locator('#best .best-tie')).toHaveText(/^Tied with .*Mar.* and .*Mar/);
});
